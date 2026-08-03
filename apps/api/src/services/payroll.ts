/**
 * Payroll engine (PRD §7, §13).
 *
 * - Period boundaries are computed from company settings and stored as UTC.
 * - The engine selects eligible delivered loads, effective pay rules,
 *   recurring items due in the period, and approved manual items.
 * - Idempotency keys: scheduler_key (period), recurring_item+period,
 *   entry+source_type+source_id+category line keys.
 * - A per-process async mutex guarantees one calculation at a time; the
 *   period status transition DRAFT→CALCULATING→PENDING_APPROVAL/FAILED is the
 *   database-level guard.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PAYROLL_CALCULATOR_VERSION, PayrollCategory, RecurringSchedule, UserRole, justEndedPeriod, PeriodBoundaries } from '@carrierpay/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import {
  CalcLine,
  computeAssistantEarnings,
  computeDispatcherEarnings,
  computeDriverEarnings,
  flatWeeklyLine,
  LoadInput,
  summarizeLines,
} from './calculator.js';
import { notifyAllManagers } from './notifications.js';

export async function getCompanySettings() {
  const settings = await prisma.companySettings.findFirst();
  if (!settings) throw new Error('Company settings are not configured.');
  return settings;
}

// ---------------------------------------------------------------------------
// Serialized calculation lock (single-instance process).
// ---------------------------------------------------------------------------
let calculationRunning = false;
const waiters: Array<() => void> = [];

async function acquireCalcLock(): Promise<() => void> {
  while (calculationRunning) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  calculationRunning = true;
  return () => {
    calculationRunning = false;
    waiters.shift()?.();
  };
}

function schedulerKeyFor(b: PeriodBoundaries): string {
  return `payroll:${b.startAt.toISOString()}:${b.endAt.toISOString()}`;
}

/** Derive the just-ended period from company settings at `now` (UTC). */
export async function derivePeriod(now = new Date()) {
  const settings = await getCompanySettings();
  const bounds = justEndedPeriod(now, settings.timezone, settings.weekStartDay);
  return { bounds, settings, schedulerKey: schedulerKeyFor(bounds) };
}

/** Create the period row if it does not already exist (idempotent by scheduler key). */
export async function ensurePeriod(bounds: PeriodBoundaries, timezone: string, schedulerKey: string) {
  const existing = await prisma.payPeriod.findUnique({ where: { schedulerKey } });
  if (existing) return existing;
  return prisma.payPeriod.create({
    data: { startAt: bounds.startAt, endAt: bounds.endAt, timezone, schedulerKey, status: 'DRAFT' },
  });
}

/** Main entrypoint: ensures the just-ended period exists, then calculates it. */
export async function calculateForWindow(now = new Date()): Promise<{ periodId: string; created: boolean }> {
  const { bounds, settings, schedulerKey } = await derivePeriod(now);
  const period = await ensurePeriod(bounds, settings.timezone, schedulerKey);
  const terminal = ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'VOID'].includes(period.status);
  if (!terminal) await calculatePeriod(period.id);
  return { periodId: period.id, created: !terminal };
}

/**
 * Calculate (or recalculate) a payroll period. Calculated lines are rebuilt;
 * manual items and adjustments are re-selected from manual_pay_items so they
 * survive recalculation (PRD §7.7).
 */
export async function calculatePeriod(periodId: string): Promise<void> {
  const release = await acquireCalcLock();
  try {
    const period = await prisma.payPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new Error(`Pay period ${periodId} not found.`);
    if (period.status === 'PUBLISHED' || period.status === 'VOID') {
      throw new Error(`Cannot recalculate a ${period.status} period.`);
    }

    const settings = await getCompanySettings();

    await prisma.payPeriod.update({ where: { id: periodId }, data: { status: 'CALCULATING', calculationStartedAt: new Date(), error: null } });

    try {
      await prisma.$transaction(async (tx) => {
        // Rebuild: delete prior calculated rows; manual_pay_items persist separately.
        await tx.recurringItemOccurrence.deleteMany({ where: { payPeriodId: periodId } });
        await tx.payrollEntry.deleteMany({ where: { payPeriodId: periodId } });

        const startAt = period.startAt;
        const endAt = period.endAt;

        // Eligible delivered loads inside the period.
        const loads = await tx.load.findMany({
          where: { status: 'DELIVERED', deliveryAt: { gte: startAt, lte: endAt } },
        });

        const loadsByDriver = new Map<string, LoadInput[]>();
        const loadsByDispatcher = new Map<string, LoadInput[]>();
        for (const load of loads) {
          const input: LoadInput = {
            id: load.id,
            loadNumber: load.loadNumber,
            customerName: load.customerName,
            grossRateCents: load.grossRateCents,
            accessorialGrossCents: load.accessorialGrossCents,
            loadedMilesHundredths: load.loadedMilesHundredths,
            emptyMilesHundredths: load.emptyMilesHundredths,
            deliveryAt: load.deliveryAt!,
          };
          if (load.driverUserId) pushTo(loadsByDriver, load.driverUserId, input);
          pushTo(loadsByDispatcher, load.bookedByUserId, input);
        }

        const activeUsers = await tx.user.findMany({ where: { status: 'ACTIVE' } });

        for (const user of activeUsers) {
          let lines: CalcLine[] = [];
          let grossRevenue = 0;
          let ruleSetId: string | null = null;
          let skip = false;

          if (user.role === UserRole.DRIVER) {
            const driverLoads = loadsByDriver.get(user.id) ?? [];
            if (driverLoads.length === 0) continue;
            const rule = await effectiveRule(tx, user.id, driverLoads[0]!.deliveryAt);
            if (!rule) {
              lines = [];
            } else {
              ruleSetId = rule.id;
              const res = computeDriverEarnings(rule.components, driverLoads);
              lines = res.lines;
              grossRevenue = res.grossRevenueCents;
              for (const comp of rule.components) {
                const weekly = flatWeeklyLine(comp);
                if (weekly) lines.push({ ...weekly, ruleSetId: rule.id });
              }
            }
          } else if (user.role === UserRole.DISPATCHER) {
            const booked = loadsByDispatcher.get(user.id) ?? [];
            if (booked.length === 0) continue;
            const rule = await effectiveRule(tx, user.id, endAt);
            if (!rule) {
              lines = [];
            } else {
              ruleSetId = rule.id;
              const res = computeDispatcherEarnings(rule.components, booked);
              lines = res.lines;
              grossRevenue = res.grossRevenueCents;
              for (const comp of rule.components) {
                const weekly = flatWeeklyLine(comp);
                if (weekly) lines.push({ ...weekly, ruleSetId: rule.id });
              }
            }
          } else if (user.role === UserRole.ASSISTANT_ACCOUNT_MANAGER) {
            const rule = await effectiveRule(tx, user.id, endAt);
            if (!rule) continue;
            ruleSetId = rule.id;
            const activeDrivers = await tx.user.count({ where: { role: UserRole.DRIVER, status: 'ACTIVE' } });
            const res = computeAssistantEarnings(rule.components, { activeDriverCount: activeDrivers, processedEarningsCents: 0 });
            lines = res.lines.map((l) => ({ ...l, ruleSetId: rule.id }));
          } else {
            continue;
          }
          void skip;

          // Attach rule-set ids where missing.
          lines = lines.map((l) => ({ ...l, ruleSetId: l.ruleSetId ?? ruleSetId }));

          // Recurring items due in this period.
          const recurring = await tx.recurringItem.findMany({
            where: {
              userId: user.id,
              active: true,
              startDate: { lte: endAt },
              OR: [{ endDate: null }, { endDate: { gte: startAt } }],
            },
          });
          for (const item of recurring) {
            const existingOccurrence = await tx.recurringItemOccurrence.findUnique({
              where: { recurringItemId_payPeriodId: { recurringItemId: item.id, payPeriodId: periodId } },
            });
            if (existingOccurrence) continue;
            if (!isRecurringDue(item, startAt, endAt)) continue;
            const hasEarnings = lines.some((l) => l.category === PayrollCategory.EARNING);
            if (!hasEarnings && !item.applyWhenNoEarnings) continue;
            lines.push({
              category: categoryForItem(item.itemType),
              sourceType: 'RECURRING_ITEM',
              sourceId: item.id,
              description: item.description ? `${item.name} — ${item.description}` : item.name,
              amountCents: item.amountCents,
              calculationJson: { recurrence: item.recurrence, quantity: item.quantity ?? 1 },
            });
          }

          // Approved manual items targeting this period.
          const manualItems = await tx.manualPayItem.findMany({
            where: { payPeriodId: periodId, userId: user.id, status: 'APPROVED_FOR_CALCULATION' },
          });
          for (const item of manualItems) {
            lines.push({
              category: categoryForItem(item.itemType),
              sourceType: 'MANUAL_ITEM',
              sourceId: item.id,
              description: item.description,
              amountCents: item.amountCents,
              calculationJson: { quantity: item.quantity ?? 1 },
            });
          }

          if (lines.length === 0) continue;
          const summarized = summarizeLines(lines);
          if (summarized.earningsCents === 0 && summarized.deductionsCents === 0 && !settings.createZeroPayEntries) {
            continue; // zero-pay entries excluded by default
          }

          const entry = await tx.payrollEntry.create({
            data: {
              payPeriodId: periodId,
              userId: user.id,
              role: user.role,
              grossRevenueCents: grossRevenue,
              earningsCents: summarized.earningsCents,
              otherPayCents: summarized.otherPayCents,
              reimbursementsCents: summarized.reimbursementsCents,
              advancesCents: summarized.advancesCents,
              deductionsCents: summarized.deductionsCents,
              netPayCents: summarized.earningsCents + summarized.otherPayCents + summarized.reimbursementsCents - summarized.advancesCents - summarized.deductionsCents,
              status: 'CALCULATED',
              validationJson: JSON.stringify(summarized.validationFlags),
              calculationHash: hashOfLines(lines),
              createdBy: 'scheduler',
            },
          });

          // Insert line items with unique (entry, source_type, source_id, category).
          const seen = new Set<string>();
          for (const line of lines) {
            const key = `${line.sourceType}:${line.sourceId ?? ''}:${line.category}`;
            if (seen.has(key)) continue;
            seen.add(key);
            await tx.payrollLineItem.create({
              data: {
                payrollEntryId: entry.id,
                category: line.category,
                sourceType: line.sourceType,
                sourceId: line.sourceId ?? null,
                description: line.description,
                amountCents: line.amountCents,
                ruleSetId: line.ruleSetId ?? ruleSetId,
                ruleComponentId: line.ruleComponentId ?? null,
                calculationJson: JSON.stringify(line.calculationJson),
                createdBy: 'scheduler',
              },
            });
          }

          // Record recurring occurrences (unique recurring_item + period).
          for (const line of lines) {
            if (line.sourceType === 'RECURRING_ITEM' && line.sourceId) {
              await tx.recurringItemOccurrence.upsert({
                where: { recurringItemId_payPeriodId: { recurringItemId: line.sourceId, payPeriodId: periodId } },
                create: { recurringItemId: line.sourceId, payPeriodId: periodId },
                update: {},
              });
            }
          }
        }

        await tx.payPeriod.update({
          where: { id: periodId },
          data: { status: 'PENDING_APPROVAL', calculatedAt: new Date(), calculatorVersion: PAYROLL_CALCULATOR_VERSION, error: null },
        });
      });

      await notifyAllManagers('PAYROLL_READY', 'Payroll batch ready for approval', `Payroll for ${period.startAt.toISOString()} is ready.`, `/payroll/${periodId}`);
    } catch (err) {
      logger.error({ err, periodId }, 'payroll calculation failed');
      await prisma.payPeriod.update({ where: { id: periodId }, data: { status: 'FAILED', error: String((err as Error).message ?? err) } });
      throw err;
    }
  } finally {
    release();
  }
}

/** Effective ACTIVE rule set for a user effective on `onDate`, with components. */
async function effectiveRule(
  tx: Prisma.TransactionClient,
  userId: string,
  onDate: Date,
) {
  return tx.payRuleSet.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    include: { components: { orderBy: { sequence: 'asc' } } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key) ?? [];
  arr.push(value);
  map.set(key, arr);
}

function isRecurringDue(
  item: { recurrence: string; intervalCount: number; dayOfMonth: number | null; startDate: Date; endDate: Date | null; maxOccurrences: number | null },
  start: Date,
  end: Date,
): boolean {
  if (item.endDate && item.endDate < start) return false;
  switch (item.recurrence) {
    case RecurringSchedule.EVERY_PAY_PERIOD:
      return item.startDate <= end;
    case RecurringSchedule.WEEKLY: {
      const weeks = Math.floor((start.getTime() - item.startDate.getTime()) / 86_400_000 / 7);
      return weeks >= 0 && weeks % item.intervalCount === 0;
    }
    case RecurringSchedule.BIWEEKLY: {
      const weeks = Math.floor((start.getTime() - item.startDate.getTime()) / 86_400_000 / 7);
      return weeks >= 0 && weeks % (2 * item.intervalCount) === 0;
    }
    case RecurringSchedule.MONTHLY: {
      if (!item.dayOfMonth) return false;
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDate() === item.dayOfMonth) return true;
      }
      return false;
    }
    case RecurringSchedule.FIXED_OCCURRENCES:
      return item.startDate <= end && (item.maxOccurrences === null || item.maxOccurrences > 0);
    default:
      return false;
  }
}

function categoryForItem(itemType: string): PayrollCategory {
  switch (itemType) {
    case 'DEDUCTION':
      return PayrollCategory.DEDUCTION;
    case 'REIMBURSEMENT':
      return PayrollCategory.REIMBURSEMENT;
    case 'ADVANCE':
      return PayrollCategory.ADVANCE;
    default:
      return PayrollCategory.OTHER_PAY;
  }
}

function hashOfLines(lines: CalcLine[]): string {
  const stable = JSON.stringify(lines.map((l) => [l.sourceType, l.sourceId, l.category, l.amountCents]));
  return createHash('sha256').update(stable).digest('hex');
}
