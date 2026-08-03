/**
 * Paystubs, publication, revision, and payment records (PRD §8).
 *
 * - Super/assistant managers may view any paystub; drivers and dispatchers
 *   only their own.
 * - Publication moves an APPROVED period to PUBLISHED and locks its loads.
 * - Revisions supersede a published paystub while preserving the settlement
 *   number (versioned -R2, -R3, ...).
 * - Payments record when/how a paystub was actually paid.
 */
import fs from 'node:fs';
import { Router } from 'express';
import { UserRole, generatePaystubsSchema, markPaidSchema } from '@carrierpay/shared';
import { ah, pagination, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf, requireRole } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { generatePaystubRecord, publishPayPeriod, revisionSettlementNumber } from '../services/paystubs.js';
import { getCompanySettings } from '../services/payroll.js';

export const paystubRoutes = Router();
paystubRoutes.use(requireAuth, requireCsrf);

function paystubWhere(role: UserRole, userId: string): Record<string, unknown> {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER) return {};
  return { payrollEntry: { is: { userId } } };
}

function authorizePaystubView(ownerUserId: string, role: UserRole, userId: string): void {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER) return;
  if (ownerUserId === userId) return;
  throw forbidden();
}

paystubRoutes.get(
  '/paystubs',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const where = paystubWhere(req.user!.role as UserRole, req.user!.id);
    const [items, total] = await Promise.all([
      prisma.paystub.findMany({
        where,
        include: {
          payrollEntry: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true } },
              payPeriod: { select: { startAt: true, endAt: true, status: true } },
            },
          },
          payments: { orderBy: { paidDate: 'desc' } },
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.paystub.count({ where }),
    ]);
    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);

paystubRoutes.get(
  '/paystubs/:id',
  ah(async (req: AuthedRequest, res) => {
    const stub = await prisma.paystub.findUnique({
      where: { id: req.params.id },
      include: {
        payrollEntry: { include: { user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true } }, lineItems: true } },
        payments: { orderBy: { paidDate: 'desc' } },
        supersedes: { select: { id: true, settlementNumber: true, version: true, generatedAt: true } },
      },
    });
    if (!stub) throw notFound('PAYSTUB_NOT_FOUND');
    authorizePaystubView(stub.payrollEntry.userId, req.user!.role as UserRole, req.user!.id);
    res.json(stub);
  }),
);

paystubRoutes.get(
  '/paystubs/:id/download',
  ah(async (req: AuthedRequest, res) => {
    const stub = await prisma.paystub.findUnique({ where: { id: req.params.id }, include: { payrollEntry: true } });
    if (!stub) throw notFound('PAYSTUB_NOT_FOUND');
    authorizePaystubView(stub.payrollEntry.userId, req.user!.role as UserRole, req.user!.id);
    if (!fs.existsSync(stub.pdfPath)) throw notFound('PAYSTUB_FILE_MISSING', 'The PDF file is missing on disk.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${stub.settlementNumber}.pdf"`);
    fs.createReadStream(stub.pdfPath).pipe(res);
  }),
);

paystubRoutes.post(
  '/pay-periods/:id/publish',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({ body: generatePaystubsSchema }),
  ah(async (req: AuthedRequest, res) => {
    const period = await prisma.payPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw notFound('PERIOD_NOT_FOUND');
    const body = req.body as { entryIds?: string[] };
    const result = await publishPayPeriod(period.id, req.user!.id, body.entryIds);
    await audit(req, {
      action: 'PAYROLL.PUBLISH',
      entityType: 'pay_period',
      entityId: period.id,
      after: { paystubCount: result.count, settlementRange: result.settlementRange },
    });
    res.json({ ok: true, ...result });
  }),
);

paystubRoutes.post(
  '/payroll-entries/:id/paystubs/revise',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  ah(async (req: AuthedRequest, res) => {
    const entry = await prisma.payrollEntry.findUnique({ where: { id: req.params.id }, include: { payPeriod: true } });
    if (!entry) throw notFound('ENTRY_NOT_FOUND');
    if (entry.payPeriod.status !== 'PUBLISHED') throw conflict('NOT_PUBLISHED', 'Revisions require a published period.');
    const company = await getCompanySettings();
    const prev = await prisma.paystub.findFirst({ where: { payrollEntryId: entry.id }, orderBy: { version: 'desc' } });
    const version = (prev?.version ?? 0) + 1;
    const settlementNumber = await revisionSettlementNumber(entry.id, company, version);
    const stub = await generatePaystubRecord({
      entryId: entry.id,
      actorId: req.user!.id,
      company,
      settlementNumber,
      supersedesPaystubId: prev?.id,
    });
    await audit(req, {
      action: 'PAYSTUB.REVISE',
      entityType: 'paystub',
      entityId: stub.id,
      after: { settlementNumber: stub.settlementNumber, version: stub.version },
    });
    res.status(201).json(stub);
  }),
);

paystubRoutes.post(
  '/paystubs/:id/mark-paid',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({ body: markPaidSchema }),
  ah(async (req: AuthedRequest, res) => {
    const stub = await prisma.paystub.findUnique({ where: { id: req.params.id } });
    if (!stub) throw notFound('PAYSTUB_NOT_FOUND');
    const body = req.body as { paidDate?: string; method?: string; reference?: string; note?: string };
    const paidDate = body.paidDate ? new Date(`${body.paidDate}T12:00:00Z`) : new Date();
    const record = await prisma.paymentRecord.create({
      data: {
        paystubId: stub.id,
        paidDate,
        method: body.method || null,
        externalReference: body.reference || null,
        note: body.note || null,
        actorId: req.user!.id,
      },
    });
    await audit(req, {
      action: 'PAYMENT.MARK_PAID',
      entityType: 'paystub',
      entityId: stub.id,
      after: { paidDate, method: body.method || null, externalReference: body.reference || null },
    });
    res.status(201).json(record);
  }),
);

paystubRoutes.get(
  '/payments',
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    if (role !== UserRole.SUPER_ACCOUNT_MANAGER && role !== UserRole.ASSISTANT_ACCOUNT_MANAGER) throw forbidden();
    const pg = pagination(req);
    const [items, total] = await Promise.all([
      prisma.paymentRecord.findMany({
        include: {
          paystub: {
            include: {
              payrollEntry: {
                include: { user: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
              },
            },
          },
          actor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { paidDate: 'desc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.paymentRecord.count(),
    ]);
    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);
