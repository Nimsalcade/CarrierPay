/**
 * Load state machine + payroll stale detection (PRD §6.4, §7.7).
 */
import { LOAD_TRANSITIONS, LoadStatus } from '@carrierpay/shared';
import { prisma } from '../lib/prisma.js';
import { conflict } from '../lib/errors.js';

export function assertTransition(from: LoadStatus, to: LoadStatus, reason?: string): void {
  const allowed = LOAD_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw conflict('INVALID_LOAD_TRANSITION', `Cannot transition load from ${from} to ${to}.${reason ? ` ${reason}` : ''}`);
  }
}

/**
 * When a delivered load that feeds a payroll entry is edited, mark those
 * entries STALE so approval is blocked until recalculation (PRD §7.7).
 * Only non-published periods are affected.
 */
export async function markStaleForLoad(loadId: string): Promise<void> {
  const lineItems = await prisma.payrollLineItem.findMany({
    where: { sourceType: 'LOAD', sourceId: loadId },
    include: {
      payrollEntry: { include: { payPeriod: true } },
    },
  });
  for (const line of lineItems) {
    const { payPeriod } = line.payrollEntry;
    if (payPeriod.status === 'PUBLISHED' || payPeriod.status === 'VOID') continue;
    await prisma.payrollEntry.update({
      where: { id: line.payrollEntryId },
      data: { status: 'STALE' },
    });
  }
}

/** Whether a delivered load's delivery falls inside the given period. */
export function deliveryInPeriod(deliveryAt: Date | null, startAt: Date, endAt: Date): boolean {
  if (!deliveryAt) return false;
  return deliveryAt >= startAt && deliveryAt <= endAt;
}
