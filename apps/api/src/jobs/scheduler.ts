/**
 * Payroll scheduler (PRD §13.2).
 *
 * - A node-cron job runs the configured trigger expression (`payrollTriggerCron`)
 *   in the company timezone. The job is re-armed whenever company settings
 *   change (polled hourly) so timezone/cron edits take effect without a restart.
 * - On each trigger the just-ended payroll window is calculated.
 * - `runStartupReconciliation` catches up any missed windows oldest-to-newest.
 */
import cron from 'node-cron';
import { WEEK_MS } from '@carrierpay/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { calculateForWindow, calculatePeriod, derivePeriod, getCompanySettings } from '../services/payroll.js';
import { notifyAllManagers } from '../services/notifications.js';

const DEFAULT_CRON = '0 0 * * 6'; // Saturday midnight
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

let currentTask: cron.ScheduledTask | null = null;
let currentKey = '';
let armed = false;
let syncTimer: ReturnType<typeof setInterval> | null = null;

/** Arm the scheduler. Idempotent; re-syncs settings once per hour. */
export function startScheduler(): void {
  void syncScheduler();
  syncTimer = setInterval(() => void syncScheduler(), SYNC_INTERVAL_MS);
  syncTimer.unref();
}

/** Stop the scheduler (used by graceful shutdown). */
export function stopScheduler(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  armed = false;
  currentKey = '';
}

async function syncScheduler(): Promise<void> {
  const settings = await getCompanySettings().catch(() => null);
  const cronExpr = settings?.payrollTriggerCron || DEFAULT_CRON;
  const timezone = settings?.timezone || 'UTC';
  const key = `${cronExpr}|${timezone}`;
  if (armed && currentKey === key) return;
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  currentKey = key;
  armed = false;
  if (!settings) return; // company not configured yet; retry on next sync
  currentTask = cron.schedule(cronExpr, () => void runPayrollWindow(), { timezone });
  armed = true;
  logger.info({ cronExpr, timezone }, 'payroll scheduler armed');
}

async function runPayrollWindow(): Promise<void> {
  try {
    const result = await calculateForWindow(new Date());
    logger.info({ result }, 'scheduled payroll window calculated');
  } catch (err) {
    logger.error({ err }, 'scheduled payroll window failed');
    await notifyAllManagers(
      'PAYROLL_RECALC_FAILED',
      'Payroll calculation failed',
      `The scheduled payroll calculation failed: ${(err as Error).message ?? 'unknown error'}`,
      '/payroll',
    ).catch(() => undefined);
  }
}

/**
 * Reconcile missed payroll windows at startup (PRD §13.2). Any period that was
 * created but left DRAFT or FAILED is recalculated, oldest-to-newest.
 * Periods that never existed are skipped (nothing to reconcile).
 */
export async function runStartupReconciliation(maxWeeksBack = 12): Promise<void> {
  const settings = await getCompanySettings().catch(() => null);
  if (!settings) return;

  const now = new Date();
  let reconciled = 0;
  let inspected = 0;

  for (let back = maxWeeksBack; back >= 0; back--) {
    const ref = new Date(now.getTime() - back * WEEK_MS);
    const { schedulerKey } = await derivePeriod(ref);
    const period = await prisma.payPeriod.findUnique({ where: { schedulerKey } });
    if (!period) continue;
    inspected++;
    if (period.status === 'DRAFT' || period.status === 'FAILED' || period.status === 'CALCULATING') {
      try {
        await calculatePeriod(period.id);
        reconciled++;
      } catch (err) {
        logger.warn({ err, periodId: period.id }, 'startup reconciliation recalculation failed');
      }
    }
  }

  logger.info({ inspected, reconciled }, 'startup payroll reconciliation complete');
}
