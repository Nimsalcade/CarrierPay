/**
 * First-run setup wizard (PRD §5.1). Only available when no company record
 * and no super account exist. Creates company settings + first super manager
 * in one transaction.
 */
import { Router } from 'express';
import { setupSchema, UserRole, UserStatus } from '@carrierpay/shared';
import { ah, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/password.js';
import { createSessionToken, setSessionCookie, AuthedRequest } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { conflict } from '../lib/errors.js';

export const setupRoutes = Router();

async function setupComplete(): Promise<boolean> {
  const [companyCount, superCount] = await Promise.all([
    prisma.companySettings.count(),
    prisma.user.count({ where: { role: UserRole.SUPER_ACCOUNT_MANAGER } }),
  ]);
  return companyCount > 0 || superCount > 0;
}

setupRoutes.get(
  '/setup/status',
  ah(async (_req, res) => {
    res.json({ required: !(await setupComplete()) });
  }),
);

setupRoutes.post(
  '/setup',
  validate({ body: setupSchema }),
  ah(async (req: AuthedRequest, res) => {
    if (await setupComplete()) {
      throw conflict('SETUP_DONE', 'Setup has already been completed.');
    }
    const body = req.body as { company: Record<string, unknown>; admin: Record<string, unknown> };
    const employeeCode = (body.admin.employeeCode as string).toUpperCase();

    const passwordHash = await hashPassword(body.admin.password as string);

    await prisma.$transaction(async (tx) => {
      await tx.companySettings.create({
        data: {
          companyName: body.company.companyName as string,
          legalName: body.company.legalName as string,
          addressLine1: (body.company.addressLine1 as string) || null,
          addressLine2: (body.company.addressLine2 as string) || null,
          city: (body.company.city as string) || null,
          state: (body.company.state as string) || null,
          zip: (body.company.zip as string) || null,
          phone: (body.company.phone as string) || null,
          email: (body.company.email as string) || null,
          timezone: body.company.timezone as string,
          weekStartDay: Number(body.company.weekStartDay ?? 6),
          payrollTriggerCron: (body.company.payrollTriggerCron as string) || '0 0 * * 6',
          goLiveDate: body.company.goLiveDate ? new Date(body.company.goLiveDate as string) : null,
          settlementPrefix: body.company.settlementPrefix as string,
          settlementPadding: Number(body.company.settlementPadding ?? 5),
          batchPrefix: body.company.batchPrefix as string,
          batchPadding: Number(body.company.batchPadding ?? 3),
          separateReimbursements: Boolean(body.company.separateReimbursements),
          createZeroPayEntries: Boolean(body.company.createZeroPayEntries),
          prorateAssistantPay: Boolean(body.company.prorateAssistantPay),
        },
      });

      await tx.user.create({
        data: {
          role: UserRole.SUPER_ACCOUNT_MANAGER,
          firstName: body.admin.firstName as string,
          lastName: body.admin.lastName as string,
          email: (body.admin.email as string).toLowerCase(),
          username: body.admin.username as string,
          employeeCode,
          passwordHash,
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
        },
      });
    });

    // Log in as the new super account.
    const user = await prisma.user.findUniqueOrThrow({ where: { employeeCode } });
    const { token, tokenHash, csrfToken, csrfHash } = createSessionToken();
    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        csrfTokenHash: csrfHash,
        expiresAt: new Date(Date.now() + 12 * 3600_000),
        ipSummary: req.ip,
      },
    });
    setSessionCookie(res, token);
    await audit(req, { action: 'SETUP.COMPLETE', entityType: 'company', entityId: user.id });

    res.status(201).json({
      ok: true,
      csrfToken,
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        employeeCode: user.employeeCode,
        status: user.status,
        mustChangePassword: true,
      },
    });
  }),
);
