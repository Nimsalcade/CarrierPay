/**
 * Role-aware dashboard aggregates (PRD §6.11). Each role sees a tailored set
 * of operational and payroll metrics.
 */
import { Router } from 'express';
import { UserRole } from '@carrierpay/shared';
import { ah } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';

export const dashboardRoutes = Router();
dashboardRoutes.use(requireAuth, requireCsrf);

const OPEN_LOAD_STATUSES = ['BOOKED', 'ASSIGNED', 'IN_TRANSIT'] as const;

dashboardRoutes.get(
  '/dashboard',
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

    const unreadCount = await prisma.notification.count({
      where: { recipientUserId: req.user!.id, readAt: null },
    });

    if (role === UserRole.SUPER_ACCOUNT_MANAGER || role === UserRole.ASSISTANT_ACCOUNT_MANAGER) {
      const [activeDrivers, activeDispatchers, activeAssistants, openLoads, deliveredThisWeek, pendingPeriods, ytd, latestPeriod] = await Promise.all([
        prisma.user.count({ where: { role: UserRole.DRIVER, status: 'ACTIVE' } }),
        prisma.user.count({ where: { role: UserRole.DISPATCHER, status: 'ACTIVE' } }),
        prisma.user.count({ where: { role: UserRole.ASSISTANT_ACCOUNT_MANAGER, status: 'ACTIVE' } }),
        prisma.load.count({ where: { status: { in: [...OPEN_LOAD_STATUSES] } } }),
        prisma.load.count({ where: { status: 'DELIVERED', deliveryAt: { gte: weekAgo } } }),
        prisma.payPeriod.count({ where: { status: 'PENDING_APPROVAL' } }),
        prisma.payrollEntry.aggregate({
          where: { status: 'PUBLISHED', payPeriod: { is: { publishedAt: { gte: yearStart } } } },
          _sum: { grossRevenueCents: true, earningsCents: true, netPayCents: true },
        }),
        prisma.payPeriod.findFirst({ orderBy: { endAt: 'desc' }, select: { id: true, startAt: true, endAt: true, status: true } }),
      ]);
      res.json({
        role,
        unreadCount,
        stats: {
          activeDrivers,
          activeDispatchers,
          activeAssistants,
          openLoads,
          deliveredThisWeek,
          pendingApprovalPeriods: pendingPeriods,
          ytdGrossRevenueCents: ytd._sum.grossRevenueCents ?? 0,
          ytdEarningsCents: ytd._sum.earningsCents ?? 0,
          ytdNetPayCents: ytd._sum.netPayCents ?? 0,
        },
        latestPeriod,
      });
      return;
    }

    if (role === UserRole.DRIVER) {
      const [activeLoads, deliveredThisWeek, ytd] = await Promise.all([
        prisma.load.count({ where: { driverUserId: req.user!.id, status: { in: [...OPEN_LOAD_STATUSES] } } }),
        prisma.load.count({ where: { driverUserId: req.user!.id, status: 'DELIVERED', deliveryAt: { gte: weekAgo } } }),
        prisma.payrollEntry.aggregate({
          where: { userId: req.user!.id, status: 'PUBLISHED', payPeriod: { is: { publishedAt: { gte: yearStart } } } },
          _sum: { earningsCents: true, netPayCents: true },
        }),
      ]);
      const latestPaystub = await prisma.paystub.findFirst({
        where: { payrollEntry: { is: { userId: req.user!.id } } },
        orderBy: { publishedAt: 'desc' },
        include: { payrollEntry: { select: { netPayCents: true } } },
      });
      res.json({
        role,
        unreadCount,
        stats: {
          activeLoads,
          deliveredThisWeek,
          ytdEarningsCents: ytd._sum.earningsCents ?? 0,
          ytdNetPayCents: ytd._sum.netPayCents ?? 0,
        },
        latestPaystub: latestPaystub
          ? {
              id: latestPaystub.id,
              settlementNumber: latestPaystub.settlementNumber,
              publishedAt: latestPaystub.publishedAt,
              netPayCents: latestPaystub.payrollEntry.netPayCents,
            }
          : null,
      });
      return;
    }

    // Dispatcher
    const [openLoads, deliveredThisWeek, deliveredTotal] = await Promise.all([
      prisma.load.count({ where: { bookedByUserId: req.user!.id, status: { in: [...OPEN_LOAD_STATUSES] } } }),
      prisma.load.count({ where: { bookedByUserId: req.user!.id, status: 'DELIVERED', deliveryAt: { gte: weekAgo } } }),
      prisma.load.count({ where: { bookedByUserId: req.user!.id, status: 'DELIVERED' } }),
    ]);
    res.json({
      role,
      unreadCount,
      stats: { openLoads, deliveredThisWeek, deliveredTotal },
    });
  }),
);
