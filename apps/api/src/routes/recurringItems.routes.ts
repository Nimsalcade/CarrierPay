/**
 * Recurring deductions, reimbursements, advances, other pay (PRD §6.6).
 */
import { Router } from 'express';
import { RecurringItemType, UserRole, recurringItemCreateSchema, recurringItemUpdateSchema } from '@carrierpay/shared';
import { ah, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

export const recurringItemRoutes = Router();
recurringItemRoutes.use(requireAuth, requireCsrf);

function canManage(role: UserRole, targetUserId: string, actorId: string, targetRole?: string): boolean {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER) return true;
  if (role === UserRole.ASSISTANT_ACCOUNT_MANAGER) return targetRole === UserRole.DRIVER;
  if (role === UserRole.DRIVER) return actorId === targetUserId; // view own active items
  return false;
}

function toDate(s?: string | null): Date | null {
  return s ? new Date(`${s}T12:00:00Z`) : null;
}

recurringItemRoutes.get(
  '/users/:id/recurring-items',
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    if (!canManage(req.user!.role as UserRole, target.id, req.user!.id, target.role)) throw forbidden();

    const items = await prisma.recurringItem.findMany({
      where: { userId: target.id },
      orderBy: { startDate: 'desc' },
    });
    res.json(items);
  }),
);

recurringItemRoutes.post(
  '/users/:id/recurring-items',
  validate({ body: recurringItemCreateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    if (!canManage(req.user!.role as UserRole, target.id, req.user!.id, target.role)) throw forbidden();

    const body = req.body as {
      itemType: RecurringItemType;
      name: string;
      description?: string;
      amountCents: number;
      recurrence: string;
      intervalCount: number;
      dayOfMonth?: number | null;
      startDate: string;
      endDate?: string | null;
      maxOccurrences?: number | null;
      applyWhenNoEarnings: boolean;
      quantity?: number | null;
    };
    const startDate = toDate(body.startDate);
    const endDate = toDate(body.endDate);
    if (!startDate) throw badRequest('INVALID_START', 'A valid start date is required.');
    if (endDate && endDate < startDate) throw badRequest('INVALID_RANGE', 'End date cannot precede start date.');
    if (body.recurrence === 'MONTHLY' && !body.dayOfMonth) {
      throw badRequest('DAY_REQUIRED', 'Monthly recurrence requires a day of month.');
    }

    const item = await prisma.recurringItem.create({
      data: {
        userId: target.id,
        itemType: body.itemType,
        name: body.name.trim().toUpperCase(),
        description: body.description || null,
        amountCents: body.amountCents,
        recurrence: body.recurrence as never,
        intervalCount: body.intervalCount,
        dayOfMonth: body.dayOfMonth ?? null,
        startDate,
        endDate,
        maxOccurrences: body.maxOccurrences ?? null,
        applyWhenNoEarnings: body.applyWhenNoEarnings,
        quantity: body.quantity ?? null,
        active: true,
      },
    });
    await audit(req, { action: 'RECURRING.CREATE', entityType: 'recurring_item', entityId: item.id, after: { itemType: item.itemType, amountCents: item.amountCents } });
    res.status(201).json(item);
  }),
);

recurringItemRoutes.patch(
  '/recurring-items/:id',
  validate({ body: recurringItemUpdateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const existing = await prisma.recurringItem.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('RECURRING_ITEM_NOT_FOUND');
    if (!canManage(req.user!.role as UserRole, existing.userId, req.user!.id)) throw forbidden();

    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of ['itemType', 'name', 'description', 'amountCents', 'recurrence', 'intervalCount', 'dayOfMonth', 'maxOccurrences', 'applyWhenNoEarnings', 'quantity', 'active']) {
      if (key in body) data[key] = body[key];
    }
    if ('startDate' in body) data.startDate = toDate(body.startDate as string);
    if ('endDate' in body) data.endDate = toDate(body.endDate as string | null);

    const updated = await prisma.recurringItem.update({ where: { id: existing.id }, data });
    await audit(req, {
      action: 'RECURRING.UPDATE',
      entityType: 'recurring_item',
      entityId: existing.id,
      before: { amountCents: existing.amountCents, recurrence: existing.recurrence, active: existing.active },
      after: { amountCents: updated.amountCents, recurrence: updated.recurrence, active: updated.active },
    });
    res.json(updated);
  }),
);
