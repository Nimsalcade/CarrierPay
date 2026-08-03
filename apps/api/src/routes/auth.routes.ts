import { Router } from 'express';
import { loginSchema, changePasswordSchema, UserRole, UserStatus } from '@carrierpay/shared';
import { ah, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { verifyPassword, hashPassword } from '../services/password.js';
import {
  AuthedRequest,
  createSessionToken,
  requireAuth,
  requireCsrf,
  resolveSession,
  setSessionCookie,
  clearSessionCookie,
} from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { AppError, unauthorized, badRequest, forbidden } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';

/** In-memory sliding-window login rate limiter (single-instance local app). */
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function loginThrottled(key: string): boolean {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt < now) {
    failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX;
}

export const authRoutes = Router();

authRoutes.post(
  '/auth/login',
  validate({ body: loginSchema }),
  ah(async (req, res) => {
    const { identifier, password } = req.body as { identifier: string; password: string };
    const key = `${req.ip}:${identifier.toLowerCase()}`;
    if (!loginThrottled(key)) {
      await audit(req, { action: 'AUTH.LOCKOUT', entityType: 'auth', reason: 'Repeated failed login attempts' });
      throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }],
      },
    });

    const valid = user ? await verifyPassword(user.passwordHash, password) : false;
    if (!user || !valid) {
      logger.warn({ ip: req.ip, identifier }, 'failed login attempt');
      throw unauthorized('Invalid email/username or password.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw forbidden('This account is not active.');
    }
    failures.delete(key);

    const { token, tokenHash, csrfToken, csrfHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + 3600_000 * config.sessionTtlHours);
    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        csrfTokenHash: csrfHash,
        expiresAt,
        ipSummary: req.ip,
        userAgentSummary: (req.headers['user-agent'] ?? '').slice(0, 200),
      },
    });
    setSessionCookie(res, token);

    await audit(req, { action: 'AUTH.LOGIN', entityType: 'user', entityId: user.id });
    res.json({ ok: true, csrfToken, user: publicUser(user) });
  }),
);

authRoutes.post('/auth/logout', requireAuth, requireCsrf, ah(async (req: AuthedRequest, res) => {
  if (req.sessionId) {
    await prisma.authSession.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'AUTH.LOGOUT', entityType: 'user', entityId: req.user!.id });
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRoutes.post(
  '/auth/change-password',
  requireAuth,
  requireCsrf,
  validate({ body: changePasswordSchema }),
  ah(async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw badRequest('INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    const same = await verifyPassword(user.passwordHash, newPassword).catch(() => false);
    if (same) throw badRequest('PASSWORD_REUSE', 'New password must differ from the current password.');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    await audit(req, { action: 'AUTH.PASSWORD_CHANGE', entityType: 'user', entityId: user.id });
    res.json({ ok: true });
  }),
);

function publicUser(user: {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  employeeCode: string;
  status: string;
  mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    username: user.username,
    employeeCode: user.employeeCode,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}

export const roleOptions = Object.values(UserRole);
