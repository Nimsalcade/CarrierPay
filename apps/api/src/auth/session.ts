/**
 * Opaque server-side sessions (PRD §6.1, §14).
 * - Raw session token travels only in an HttpOnly, SameSite=Strict cookie.
 * - SQLite stores only a SHA-256 hash of the token.
 * - CSRF token is issued at session creation and verified on unsafe methods.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../lib/config.js';
import { prisma } from '../lib/prisma.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';

const SHA256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export interface SessionUser {
  id: string;
  role: string;
  status: string;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
  csrfToken?: string;
  requestId?: string;
}

export function createSessionToken(): { token: string; tokenHash: string; csrfToken: string; csrfHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  return { token, tokenHash: SHA256(token), csrfToken, csrfHash: SHA256(csrfToken) };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: '/',
    maxAge: config.sessionTtlHours * 3600_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, { httpOnly: true, sameSite: 'strict', path: '/' });
}

/** Look up a live session from the cookie; attach user context to the request. */
export async function resolveSession(req: AuthedRequest): Promise<boolean> {
  const token = req.cookies?.[config.sessionCookieName] as string | undefined;
  if (!token) return false;
  const tokenHash = SHA256(token);
  const session = await prisma.authSession.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!session || session.user.status !== 'ACTIVE') return false;
  req.user = { id: session.user.id, role: session.user.role, status: session.user.status };
  req.sessionId = session.id;
  req.csrfToken = session.csrfTokenHash ?? undefined;
  return true;
}

/** Require an authenticated, active session. */
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const ok = await resolveSession(req);
      if (!ok) return next(unauthorized());
      next();
    } catch (err) {
      next(err);
    }
  })();
}

/** Require a valid CSRF token on unsafe methods (PRD §11.1). */
export function requireCsrf(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.csrfToken) return next(forbidden('CSRF token missing'));
  const header = req.header('x-csrf-token');
  if (!header || SHA256(header) !== req.csrfToken) {
    return next(forbidden('Invalid CSRF token'));
  }
  next();
}

/** Require one of the given roles. */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export class ForbiddenError extends AppError {}
