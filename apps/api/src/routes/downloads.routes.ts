/**
 * CSV data exports (PRD §12.5). Downloads are role-gated and always reflect
 * the current database state.
 */
import { Router } from 'express';
import type { Response } from 'express';
import { UserRole, centsToDecimalString } from '@carrierpay/shared';
import { ah } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { forbidden } from '../lib/errors.js';

export const downloadRoutes = Router();
downloadRoutes.use(requireAuth, requireCsrf);

function requireManager(role: UserRole): void {
  if (role !== UserRole.SUPER_ACCOUNT_MANAGER && role !== UserRole.ASSISTANT_ACCOUNT_MANAGER) throw forbidden();
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

function sendCsv(res: Response, fileName: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(csv);
}

downloadRoutes.get(
  '/downloads/loads.csv',
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    if (role === UserRole.DRIVER) throw forbidden();
    const where: Record<string, unknown> = {};
    if (role === UserRole.DISPATCHER) where.bookedByUserId = req.user!.id;

    const loads = await prisma.load.findMany({
      where,
      include: {
        driver: { select: { firstName: true, lastName: true, employeeCode: true } },
        bookedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const csv = toCsv(
      ['loadNumber', 'customerName', 'status', 'driver', 'bookedBy', 'originFacility', 'destinationFacility', 'pickupAt', 'deliveryAt', 'grossRate', 'accessorialGross', 'loadedMiles', 'emptyMiles', 'createdAt'],
      loads.map((l) => [
        l.loadNumber,
        l.customerName,
        l.status,
        l.driver ? `${l.driver.firstName} ${l.driver.lastName}` : '',
        l.bookedBy ? `${l.bookedBy.firstName} ${l.bookedBy.lastName}` : '',
        l.originFacility,
        l.destinationFacility,
        l.pickupAt?.toISOString() ?? '',
        l.deliveryAt?.toISOString() ?? '',
        centsToDecimalString(l.grossRateCents),
        l.accessorialGrossCents === null ? '' : centsToDecimalString(l.accessorialGrossCents),
        (l.loadedMilesHundredths / 100).toFixed(2),
        (l.emptyMilesHundredths / 100).toFixed(2),
        l.createdAt.toISOString(),
      ]),
    );
    sendCsv(res, 'loads.csv', csv);
  }),
);

downloadRoutes.get(
  '/downloads/payroll.csv',
  ah(async (req: AuthedRequest, res) => {
    requireManager(req.user!.role as UserRole);
    const entries = await prisma.payrollEntry.findMany({
      include: { user: { select: { firstName: true, lastName: true, employeeCode: true, role: true } }, payPeriod: { select: { startAt: true, endAt: true, status: true } } },
      orderBy: [{ payPeriod: { endAt: 'desc' } }, { user: { lastName: 'asc' } }],
      take: 10000,
    });
    const csv = toCsv(
      ['employeeCode', 'name', 'role', 'periodStart', 'periodEnd', 'periodStatus', 'grossRevenue', 'earnings', 'otherPay', 'reimbursements', 'advances', 'deductions', 'netPay', 'status'],
      entries.map((e) => [
        e.user.employeeCode,
        `${e.user.firstName} ${e.user.lastName}`,
        e.user.role,
        e.payPeriod.startAt.toISOString(),
        e.payPeriod.endAt.toISOString(),
        e.payPeriod.status,
        centsToDecimalString(e.grossRevenueCents),
        centsToDecimalString(e.earningsCents),
        centsToDecimalString(e.otherPayCents),
        centsToDecimalString(e.reimbursementsCents),
        centsToDecimalString(e.advancesCents),
        centsToDecimalString(e.deductionsCents),
        centsToDecimalString(e.netPayCents),
        e.status,
      ]),
    );
    sendCsv(res, 'payroll.csv', csv);
  }),
);

downloadRoutes.get(
  '/downloads/users.csv',
  ah(async (req: AuthedRequest, res) => {
    requireManager(req.user!.role as UserRole);
    const users = await prisma.user.findMany({
      where: { role: req.user!.role === 'SUPER_ACCOUNT_MANAGER' ? undefined : UserRole.DRIVER },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 10000,
    });
    const csv = toCsv(
      ['employeeCode', 'name', 'role', 'email', 'status', 'driverType', 'hireDate'],
      users.map((u) => [
        u.employeeCode,
        `${u.firstName} ${u.lastName}`,
        u.role,
        u.email ?? '',
        u.status,
        u.driverType ?? '',
        u.hireDate ? u.hireDate.toISOString().slice(0, 10) : '',
      ]),
    );
    sendCsv(res, 'users.csv', csv);
  }),
);
