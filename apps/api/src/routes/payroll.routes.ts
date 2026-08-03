/**
 * Payroll batch review, adjustment, approval (PRD §6.7, §11).
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { PayrollCategory, UserRole, approvalSchema, payrollAdjustmentSchema, zonedTimeToUtc } from '@carrierpay/shared';
import { ah, pagination, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { calculatePeriod, getCompanySettings } from '../services/payroll.js';
import { notifyAllManagers } from '../services/notifications.js';

export const payrollRoutes = Router();
payrollRoutes.use(requireAuth, requireCsrf);

function canViewPeriod(role: UserRole): boolean {
  return role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER;
}

payrollRoutes.get(
  '/pay-periods',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const role = req.user!.role as UserRole;
    if (!canViewPeriod(role)) throw forbidden();

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [periods, total] = await Promise.all([
      prisma.payPeriod.findMany({
        where,
        include: { entries: { select: { id: true, netPayCents: true, earningsCents: true, status: true } } },
        orderBy: { endAt: 'desc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.payPeriod.count({ where }),
    ]);

    res.json({
      items: periods.map((p) => ({
        id: p.id,
        startAt: p.startAt,
        endAt: p.endAt,
        status: p.status,
        peopleCount: p.entries.length,
        grossRevenueCents: p.entries.reduce((s, e) => s + 0, 0),
        earningsCents: p.entries.reduce((s, e) => s + e.earningsCents, 0),
        additionsCents: p.entries.reduce((s, e) => s + 0, 0),
        subtractionsCents: p.entries.reduce((s, e) => s + 0, 0),
        netPayCents: p.entries.reduce((s, e) => s + e.netPayCents, 0),
        validationFlags: [],
      })),
      total,
      page: pg.page,
      pageSize: pg.pageSize,
    });
  }),
);

payrollRoutes.post(
  '/pay-periods/calculate',
  ah(async (req: AuthedRequest, res) => {
    if (req.user!.role !== UserRole.SUPER_ACCOUNT_MANAGER) throw forbidden();
    const result = await calculatePeriodWindow();
    await audit(req, { action: 'PAYROLL.CALCULATE', entityType: 'pay_period', entityId: result.periodId });
    res.json({ ok: true, periodId: result.periodId, created: result.created });
  }),
);

async function calculatePeriodWindow() {
  const { calculateForWindow } = await import('../services/payroll.js');
  return calculateForWindow(new Date());
}

payrollRoutes.post(
  '/pay-periods/:id/recalculate',
  ah(async (req: AuthedRequest, res) => {
    if (req.user!.role !== UserRole.SUPER_ACCOUNT_MANAGER) throw forbidden();
    const period = await prisma.payPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw notFound('PERIOD_NOT_FOUND');
    await calculatePeriod(period.id);
    await audit(req, { action: 'PAYROLL.RECALCULATE', entityType: 'pay_period', entityId: period.id });
    res.json({ ok: true });
  }),
);

payrollRoutes.get(
  '/pay-periods/:id',
  ah(async (req: AuthedRequest, res) => {
    const period = await prisma.payPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw notFound('PERIOD_NOT_FOUND');
    if (!canViewPeriod(req.user!.role as UserRole)) throw forbidden();

    const entries = await prisma.payrollEntry.findMany({
      where: { payPeriodId: period.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true } },
        lineItems: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }],
    });

    const batch = entries.reduce(
      (acc, e) => {
        acc.grossRevenueCents += e.grossRevenueCents;
        acc.earningsCents += e.earningsCents;
        acc.reimbursementsCents += e.reimbursementsCents;
        acc.advancesCents += e.advancesCents;
        acc.deductionsCents += e.deductionsCents;
        acc.netPayCents += e.netPayCents;
        return acc;
      },
      { grossRevenueCents: 0, earningsCents: 0, reimbursementsCents: 0, advancesCents: 0, deductionsCents: 0, netPayCents: 0 },
    );

    res.json({
      id: period.id,
      startAt: period.startAt,
      endAt: period.endAt,
      timezone: period.timezone,
      status: period.status,
      totalsHash: period.totalsHash,
      error: period.error,
      batch: { ...batch, additionsCents: batch.reimbursementsCents, subtractionsCents: batch.advancesCents + batch.deductionsCents },
      entries: entries.map((e) => serializeEntry(e, e.lineItems)),
    });
  }),
);

payrollRoutes.get(
  '/payroll-entries/:id',
  ah(async (req: AuthedRequest, res) => {
    const entry = await prisma.payrollEntry.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true } },
        lineItems: { orderBy: { createdAt: 'asc' } },
        payPeriod: true,
      },
    });
    if (!entry) throw notFound('ENTRY_NOT_FOUND');
    const role = req.user!.role as UserRole;
    if (role === UserRole.DRIVER && entry.userId !== req.user!.id) throw forbidden();
    if (role === UserRole.DISPATCHER && entry.userId !== req.user!.id) throw forbidden();
    if (role === UserRole.ASSISTANT_ACCOUNT_MANAGER || role === UserRole.SUPER_ACCOUNT_MANAGER) {
      // allowed
    } else if (role !== UserRole.DRIVER && role !== UserRole.DISPATCHER) {
      throw forbidden();
    }

    const ytd = await ytdForEntry(entry.userId, entry.payPeriodId);
    res.json(serializeEntry(entry, entry.lineItems, { includeYtd: true, ytd }));
  }),
);

payrollRoutes.post(
  '/payroll-entries/:id/adjustments',
  validate({ body: payrollAdjustmentSchema }),
  ah(async (req: AuthedRequest, res) => {
    const entry = await prisma.payrollEntry.findUnique({ where: { id: req.params.id }, include: { payPeriod: true } });
    if (!entry) throw notFound('ENTRY_NOT_FOUND');
    const role = req.user!.role as UserRole;
    const isSuper = role === UserRole.SUPER_ACCOUNT_MANAGER;
    const isAssistant = role === UserRole.ASSISTANT_ACCOUNT_MANAGER;
    if (!isSuper && !isAssistant) throw forbidden();
    if (entry.payPeriod.status === 'PUBLISHED' || entry.payPeriod.status === 'VOID') {
      throw conflict('PERIOD_CLOSED', 'Cannot adjust a published/voided period.');
    }

    const body = req.body as { amountCents: number; itemType: string; description: string; reason: string; quantity?: number | null };
    // Store deductions/advances as positive cents; sign is applied at display.
    const itemType = body.itemType === 'MANUAL_ADJUSTMENT' ? 'OTHER_PAY' : body.itemType;

    await prisma.$transaction(async (tx) => {
      await tx.manualPayItem.create({
        data: {
          userId: entry.userId,
          payPeriodId: entry.payPeriodId,
          itemType: itemType as never,
          amountCents: Math.abs(body.amountCents),
          description: body.description,
          quantity: body.quantity ?? null,
          status: isSuper ? 'APPROVED_FOR_CALCULATION' : 'PROPOSED',
          createdBy: req.user!.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'PAYROLL.ADJUSTMENT',
          entityType: 'payroll_entry',
          entityId: entry.id,
          afterJson: JSON.stringify({ amountCents: body.amountCents, description: body.description }),
          reason: body.reason,
          requestId: req.id == null ? undefined : String(req.id),
        },
      });
    });

    // Recalculate so the manual line is folded into the entry.
    if (isSuper) {
      await calculatePeriod(entry.payPeriodId);
    }

    res.json({ ok: true, recalculated: isSuper, status: isSuper ? 'APPROVED_FOR_CALCULATION' : 'PROPOSED' });
  }),
);

payrollRoutes.post(
  '/pay-periods/:id/approve',
  validate({ body: approvalSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (req.user!.role !== UserRole.SUPER_ACCOUNT_MANAGER) throw forbidden();
    const period = await prisma.payPeriod.findUnique({ where: { id: req.params.id }, include: { entries: true } });
    if (!period) throw notFound('PERIOD_NOT_FOUND');
    if (period.status !== 'PENDING_APPROVAL') throw conflict('INVALID_STATUS', `Period must be PENDING_APPROVAL, not ${period.status}.`);

    // Block approval while blocking validation flags exist.
    const blocking = new Set(['MISSING_PAY_RULE', 'MISSING_LOAD_RATE', 'MISSING_MILEAGE', 'DUPLICATE_SOURCE', 'STALE_ENTRY', 'NEGATIVE_NET']);
    const flags: Array<{ entryId: string; flags: string[] }> = [];
    for (const entry of period.entries) {
      const f = JSON.parse(entry.validationJson || '[]') as string[];
      if (f.some((x) => blocking.has(x))) flags.push({ entryId: entry.id, flags: f });
    }
    if (flags.length > 0) {
      throw badRequest('VALIDATION_BLOCKS', `Approval blocked by validation flags on ${flags.length} entr(ies).`, { validation: [JSON.stringify(flags)] });
    }

    const totalsHash = computeTotalsHash(period.entries);
    const comments = (req.body as { comments?: string }).comments || null;

    await prisma.$transaction(async (tx) => {
      await tx.payrollApproval.create({
        data: {
          payPeriodId: period.id,
          actorId: req.user!.id,
          action: 'APPROVE',
          totalsHash,
          comment: comments,
        },
      });
      await tx.payPeriod.update({ where: { id: period.id }, data: { status: 'APPROVED', approvedAt: new Date(), totalsHash } });
      await tx.payrollEntry.updateMany({ where: { payPeriodId: period.id }, data: { status: 'APPROVED' } });
    });
    await audit(req, { action: 'PAYROLL.APPROVE', entityType: 'pay_period', entityId: period.id, after: { totalsHash }, reason: comments ?? undefined });
    res.json({ ok: true, totalsHash });
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeEntry(
  entry: {
    id: string;
    payPeriodId: string;
    userId: string;
    role: string;
    grossRevenueCents: number;
    earningsCents: number;
    otherPayCents: number;
    reimbursementsCents: number;
    advancesCents: number;
    deductionsCents: number;
    netPayCents: number;
    status: string;
    validationJson: string;
    user?: { id: string; firstName: string; lastName: string; employeeCode: string; role: string };
  },
  lineItems: Array<{ id: string; category: string; sourceType: string; sourceId: string | null; description: string; amountCents: number; ruleSetId: string | null; ruleComponentId: string | null; calculationJson: string | null; originalAmountCents: number | null; overrideReason: string | null }>,
  opts?: { includeYtd?: boolean; ytd?: unknown },
) {
  return {
    id: entry.id,
    payPeriodId: entry.payPeriodId,
    user: entry.user ?? { id: entry.userId, firstName: '', lastName: '', employeeCode: '', role: entry.role },
    totals: {
      grossRevenueCents: entry.grossRevenueCents,
      earningsCents: entry.earningsCents,
      otherPayCents: entry.otherPayCents,
      reimbursementsCents: entry.reimbursementsCents,
      advancesCents: entry.advancesCents,
      deductionsCents: entry.deductionsCents,
      netPayCents: entry.netPayCents,
    },
    status: entry.status,
    validationFlags: JSON.parse(entry.validationJson || '[]'),
    lineItems: lineItems.map((l) => ({ ...l, calculationJson: l.calculationJson ? JSON.parse(l.calculationJson) : null })),
    ...(opts?.includeYtd ? { ytdPreview: opts.ytd } : {}),
  };
}

export async function ytdForEntry(userId: string, excludeEntryId: string): Promise<Record<string, number> | null> {
  const yearStart = new Date(new Date().getUTCFullYear(), 0, 1);
  const entries = await prisma.payrollEntry.findMany({
    where: {
      userId,
      status: { in: ['PUBLISHED'] },
      payPeriod: { publishedAt: { gte: yearStart } },
    },
  });
  const current = await prisma.payrollEntry.findUnique({ where: { id: excludeEntryId } });
  const all = [...entries];
  if (current) all.push(current);
  if (all.length === 0) return null;
  const sum = (key: 'earningsCents' | 'otherPayCents' | 'reimbursementsCents' | 'advancesCents' | 'deductionsCents' | 'netPayCents') =>
    all.reduce((s, e) => s + e[key], 0);
  return {
    earningsCents: sum('earningsCents'),
    otherPayCents: sum('otherPayCents'),
    reimbursementsCents: sum('reimbursementsCents'),
    advancesCents: sum('advancesCents'),
    deductionsCents: sum('deductionsCents'),
    netPayCents: sum('netPayCents'),
  };
}

export function computeTotalsHash(
  entries: Array<{ id: string; earningsCents: number; otherPayCents: number; reimbursementsCents: number; advancesCents: number; deductionsCents: number; netPayCents: number }>,
): string {
  const stable = JSON.stringify(
    entries.map((e) => [e.id, e.earningsCents, e.otherPayCents, e.reimbursementsCents, e.advancesCents, e.deductionsCents, e.netPayCents]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  return createHash('sha256').update(stable).digest('hex');
}

// Referenced for timezone-correct display.
export { zonedTimeToUtc, PayrollCategory };
