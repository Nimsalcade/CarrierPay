import { Router } from 'express';
import { ah } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { permissionsFor } from '../lib/permissions.js';
import { notFound } from '../lib/errors.js';
import type { UserRole } from '@carrierpay/shared';

export const meRoutes = Router();

meRoutes.get(
  '/me',
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        payRuleSets: {
          where: {
            status: 'ACTIVE',
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { components: { orderBy: { sequence: 'asc' } } },
        },
      },
    });
    if (!user) throw notFound('USER_NOT_FOUND');

    const company = await prisma.companySettings.findFirst();
    const unreadCount = await prisma.notification.count({
      where: { recipientUserId: user.id, readAt: null },
    });

    const activeRule = user.payRuleSets[0];
    res.json({
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      username: user.username,
      employeeCode: user.employeeCode,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      permissions: permissionsFor(user.role as UserRole),
      activeRuleSummary: activeRule
        ? {
            ruleSetId: activeRule.id,
            name: activeRule.name,
            effectiveFrom: activeRule.effectiveFrom,
            components: activeRule.components.map((c) => c.displayLabel ?? c.calculationMethod),
          }
        : null,
      unreadCount,
      company: company ? { id: company.id, companyName: company.companyName, timezone: company.timezone } : null,
    });
  }),
);

meRoutes.post('/me/logout-all', requireAuth, requireCsrf, ah(async (req: AuthedRequest, res) => {
  await prisma.authSession.updateMany({
    where: { userId: req.user!.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.json({ ok: true });
}));
