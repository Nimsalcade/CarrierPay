/**
 * Staff & driver management (PRD §6.2, §4.3).
 * No destructive hard-deletes for users with linked records; lifecycle uses
 * SUSPENDED / TERMINATED status.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  UserRole,
  UserStatus,
  userCreateSchema,
  userUpdateSchema,
  userStatusSchema,
  resetPasswordSchema,
} from '@carrierpay/shared';
import { ah, pagination, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/password.js';
import { AuthedRequest, requireAuth, requireCsrf, requireRole } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

export const userRoutes = Router();
userRoutes.use(requireAuth, requireCsrf);

function canCreateRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === UserRole.SUPER_ACCOUNT_MANAGER) return true;
  if (actorRole === UserRole.ASSISTANT_ACCOUNT_MANAGER) return targetRole === UserRole.DRIVER;
  return false;
}

userRoutes.get(
  '/users',
  ah(async (req: AuthedRequest, res) => {
    if (!req.user) throw forbidden();
    const isSuper = req.user.role === UserRole.SUPER_ACCOUNT_MANAGER;
    const isAssistant = req.user.role === UserRole.ASSISTANT_ACCOUNT_MANAGER;
    if (!isSuper && !isAssistant) throw forbidden();

    const pg = pagination(req);
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (pg.q) {
      where.OR = [
        { firstName: { contains: pg.q } },
        { lastName: { contains: pg.q } },
        { employeeCode: { contains: pg.q } },
      ];
    }
    // Assistants only see drivers.
    if (isAssistant) where.role = UserRole.DRIVER;

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: pg.skip,
        take: pg.take,
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
          employeeCode: true,
          status: true,
          driverType: true,
          hireDate: true,
          terminationDate: true,
          mustChangePassword: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);

// Minimal active-driver roster so dispatchers can assign drivers when booking
// loads (they cannot list the full /users directory).
userRoutes.get(
  '/drivers',
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    const rosterRoles: UserRole[] = [UserRole.SUPER_ACCOUNT_MANAGER, UserRole.ASSISTANT_ACCOUNT_MANAGER, UserRole.DISPATCHER];
    if (!rosterRoles.includes(role)) throw forbidden();
    const drivers = await prisma.user.findMany({
      where: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, employeeCode: true, driverType: true },
    });
    res.json(drivers);
  }),
);

userRoutes.post(
  '/users',
  validate({ body: userCreateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const body = req.body as {
      role: UserRole;
      firstName: string;
      lastName: string;
      email?: string;
      username?: string;
      employeeCode: string;
      phone?: string;
      hireDate?: string;
      temporaryPassword: string;
      driverType?: string;
      address?: string;
    };
    if (!canCreateRole(req.user!.role as UserRole, body.role)) throw forbidden();

    const employeeCode = body.employeeCode.toUpperCase();
    const email = body.email ? body.email.toLowerCase() : null;
    const username = body.username || null;

    // In a single transaction: account + audit.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          role: body.role,
          firstName: body.firstName,
          lastName: body.lastName,
          email,
          username,
          employeeCode,
          phone: body.phone || null,
          hireDate: body.hireDate ? new Date(`${body.hireDate}T12:00:00Z`) : null,
          driverType: body.driverType,
          address: body.address || null,
          passwordHash: await hashPassword(body.temporaryPassword),
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
          createdBy: req.user!.id,
        },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          email: true,
          employeeCode: true,
          status: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'USER.CREATE',
          entityType: 'user',
          entityId: created.id,
          afterJson: JSON.stringify({ role: created.role, employeeCode: created.employeeCode }),
          requestId: req.id == null ? undefined : String(req.id),
        },
      });
      return created;
    });
    res.status(201).json(user);
  }),
);

userRoutes.get(
  '/users/:id',
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        payRuleSets: { orderBy: { effectiveFrom: 'desc' }, include: { components: { orderBy: { sequence: 'asc' } } } },
        recurringItems: { orderBy: { startDate: 'desc' } },
        assignments: { include: { equipment: true }, orderBy: { assignedAt: 'desc' } },
      },
    });
    if (!target) throw notFound('USER_NOT_FOUND');
    authorizeView(req.user!.role as UserRole, req.user!.id, target.id, target.role as UserRole);
    res.json(target);
  }),
);

userRoutes.patch(
  '/users/:id',
  validate({ body: userUpdateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    const isSuper = req.user!.role === UserRole.SUPER_ACCOUNT_MANAGER;
    if (!isSuper && req.user!.id !== target.id) throw forbidden();

    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of ['firstName', 'lastName', 'phone', 'driverType', 'address']) {
      if (key in body) data[key] = body[key];
    }
    if ('email' in body) data.email = body.email ? (body.email as string).toLowerCase() : null;
    if ('hireDate' in body) data.hireDate = body.hireDate ? new Date(`${body.hireDate as string}T12:00:00Z`) : null;

    const updated = await prisma.user.update({ where: { id: target.id }, data });
    await audit(req, {
      action: 'USER.UPDATE',
      entityType: 'user',
      entityId: target.id,
      before: { firstName: target.firstName, lastName: target.lastName },
      after: { firstName: updated.firstName, lastName: updated.lastName },
    });
    res.json(updated);
  }),
);

userRoutes.post(
  '/users/:id/reset-password',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({ body: resetPasswordSchema }),
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    const passwordHash = await hashPassword((req.body as { newTemporaryPassword: string }).newTemporaryPassword);
    // Invalidate all existing sessions.
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true } }),
      prisma.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'USER.PASSWORD_RESET', entityType: 'user', entityId: target.id, reason: 'Credential reset by super manager' });
    res.json({ ok: true });
  }),
);

userRoutes.post(
  '/users/:id/status',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({ body: userStatusSchema }),
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    if (target.id === req.user!.id) throw badRequest('SELF_STATUS', 'You cannot change your own status.');

    const { status, reason, effectiveDate } = req.body as { status: UserStatus; reason: string; effectiveDate?: string };
    if (target.status === status) throw conflict('SAME_STATUS', `Account is already ${status}.`);

    const data: Record<string, unknown> = { status };
    if (status === UserStatus.TERMINATED) {
      data.terminationDate = effectiveDate ? new Date(`${effectiveDate}T12:00:00Z`) : new Date();
      await prisma.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    if (status === UserStatus.ACTIVE) data.terminationDate = null;

    const updated = await prisma.user.update({ where: { id: target.id }, data });
    await audit(req, {
      action: 'USER.STATUS',
      entityType: 'user',
      entityId: target.id,
      before: { status: target.status },
      after: { status },
      reason,
    });
    res.json({ id: updated.id, status: updated.status });
  }),
);

/** Role conversion: end old role profile, create a new one requiring a new rule. */
userRoutes.post(
  '/users/:id/convert-role',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({
    body: userStatusSchema.extend({ role: z.enum(Object.values(UserRole) as [string, ...string[]]) }).omit({ status: true, effectiveDate: true }),
  }),
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { payRuleSets: true } });
    if (!target) throw notFound('USER_NOT_FOUND');
    const newRole = (req.body as { role: UserRole }).role;
    if (newRole === target.role) throw conflict('SAME_ROLE', 'User already has that role.');

    await prisma.$transaction(async (tx) => {
      await tx.payRuleSet.updateMany({ where: { userId: target.id, status: 'ACTIVE' }, data: { status: 'ENDED', effectiveTo: new Date() } });
      await tx.user.update({ where: { id: target.id }, data: { role: newRole } });
    });
    await audit(req, {
      action: 'USER.ROLE_CONVERT',
      entityType: 'user',
      entityId: target.id,
      before: { role: target.role },
      after: { role: newRole },
      reason: (req.body as { reason: string }).reason,
    });
    res.json({ id: target.id, role: newRole });
  }),
);

function authorizeView(actorRole: UserRole, actorId: string, targetId: string, targetRole: UserRole): void {
  if (actorRole === UserRole.SUPER_ACCOUNT_MANAGER) return;
  if (actorRole === UserRole.ASSISTANT_ACCOUNT_MANAGER && targetRole === UserRole.DRIVER) return;
  if (actorId === targetId) return;
  throw forbidden();
}
