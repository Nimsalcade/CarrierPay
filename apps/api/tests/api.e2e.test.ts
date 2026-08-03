/**
 * End-to-end integration tests (PRD §17 golden path).
 *
 * Boots the real Express app against the temp seeded database built by
 * global-setup.ts, then walks: health → setup status → login/CSRF → /me →
 * dashboard → payroll review → approval → audit. Assertions pin the PRD golden
 * numbers end to end.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma, configurePragmas } from '../src/lib/prisma.js';

/** PRD §17 golden fixture (cents). */
const GOLDEN = { gross: 1322540, earnings: 396762, reimb: 8790, deduct: 25000, net: 380552 };

interface Authed {
  cookie: string;
  csrfToken: string;
}

let app: Express;
let admin: Authed;
let driver: Authed;
let periodId: string;

async function login(identifier: string, password: string): Promise<{ status: number; body: Record<string, unknown>; cookie: string }> {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password });
  const setCookie = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const cookie = setCookie[0]?.split(';')[0] ?? '';
  return { status: res.status, body: res.body as Record<string, unknown>, cookie };
}

function withAuth(a: Authed): Record<string, string> {
  return { Cookie: a.cookie, 'X-CSRF-Token': a.csrfToken };
}

beforeAll(async () => {
  await configurePragmas();
  app = createApp();

  const adminRes = await login('admin', 'AdminPass123!');
  expect(adminRes.status).toBe(200);
  expect(adminRes.body.ok).toBe(true);
  admin = { cookie: adminRes.cookie, csrfToken: String(adminRes.body.csrfToken) };

  const driverRes = await login('driver', 'DriverPass123!');
  expect(driverRes.status).toBe(200);
  driver = { cookie: driverRes.cookie, csrfToken: String(driverRes.body.csrfToken) };

  // Find the seeded PENDING_APPROVAL period for later assertions.
  const periods = await prisma.payPeriod.findFirst({ where: { status: 'PENDING_APPROVAL' }, orderBy: { endAt: 'desc' } });
  expect(periods).not.toBeNull();
  periodId = periods!.id;
});

describe('health & setup', () => {
  it('reports healthy', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'carrierpay-api' });
  });

  it('reports setup already complete (seeded)', async () => {
    const res = await request(app).get('/api/v1/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(false);
  });
});

describe('authentication & authorization', () => {
  it('rejects a bad password', async () => {
    const res = await login('admin', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('requires auth on protected routes', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('returns the super manager profile and permissions', async () => {
    const res = await request(app).get('/api/v1/me').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.employeeCode).toBe('ADMIN');
    expect(res.body.role).toBe('SUPER_ACCOUNT_MANAGER');
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.permissions).toContain('payroll.approve');
  });

  it('returns the driver profile with a DRIVER permission set', async () => {
    const res = await request(app).get('/api/v1/me').set('Cookie', driver.cookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('DRIVER');
    expect(res.body.permissions).not.toContain('payroll.approve');
  });
});

describe('role-aware dashboard (PRD §6.11)', () => {
  it('shows the super manager operational summary', async () => {
    const res = await request(app).get('/api/v1/dashboard').set(withAuth(admin));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('SUPER_ACCOUNT_MANAGER');
    expect(res.body.stats.activeDrivers).toBe(1);
    expect(res.body.stats.deliveredThisWeek).toBe(7); // the golden loads
    expect(res.body.stats.pendingApprovalPeriods).toBeGreaterThanOrEqual(1);
  });

  it('shows the driver a driver-scoped dashboard', async () => {
    const res = await request(app).get('/api/v1/dashboard').set(withAuth(driver));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('DRIVER');
    expect(res.body.stats.deliveredThisWeek).toBe(7);
  });
});

describe('payroll golden fixture (PRD §17)', () => {
  it('lists the PENDING_APPROVAL period', async () => {
    const res = await request(app).get('/api/v1/pay-periods').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    const period = (res.body.items as Array<{ id: string; status: string }>).find((p) => p.id === periodId);
    expect(period).toBeDefined();
    expect(period?.status).toBe('PENDING_APPROVAL');
  });

  it('returns the driver entry with the exact golden numbers', async () => {
    const res = await request(app).get(`/api/v1/pay-periods/${periodId}`).set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    const driverEntry = (res.body.entries as Array<{ user: { employeeCode: string }; totals: Record<string, number> }>).find(
      (e) => e.user.employeeCode === 'DRV001',
    );
    expect(driverEntry).toBeDefined();
    expect(driverEntry!.totals.grossRevenueCents).toBe(GOLDEN.gross);
    expect(driverEntry!.totals.earningsCents).toBe(GOLDEN.earnings);
    expect(driverEntry!.totals.reimbursementsCents).toBe(GOLDEN.reimb);
    expect(driverEntry!.totals.deductionsCents).toBe(GOLDEN.deduct);
    expect(driverEntry!.totals.netPayCents).toBe(GOLDEN.net);
    // No blocking flags → approval must not be blocked.
    expect(driverEntry!.validationFlags).toEqual([]);
  });

  it('blocks drivers from viewing the payroll period', async () => {
    const res = await request(app).get(`/api/v1/pay-periods/${periodId}`).set('Cookie', driver.cookie);
    expect(res.status).toBe(403);
  });

  it('recalculate is idempotent — totals do not drift', async () => {
    const first = await request(app).get(`/api/v1/pay-periods/${periodId}`).set('Cookie', admin.cookie);
    await request(app)
      .post(`/api/v1/pay-periods/${periodId}/recalculate`)
      .set(withAuth(admin))
      .expect(200);
    const second = await request(app).get(`/api/v1/pay-periods/${periodId}`).set('Cookie', admin.cookie);
    expect(first.body.entries).toHaveLength(second.body.entries.length);
    const sumTotals = (entries: Array<{ totals: { netPayCents: number } }>) => entries.reduce((s, e) => s + e.totals.netPayCents, 0);
    expect(sumTotals(first.body.entries)).toBe(sumTotals(second.body.entries));
  });

  it('approves the period and locks the totals hash', async () => {
    const res = await request(app)
      .post(`/api/v1/pay-periods/${periodId}/approve`)
      .send({ comments: 'Golden fixture approved by e2e' })
      .set(withAuth(admin));
    expect(res.status).toBe(200);
    expect(typeof res.body.totalsHash).toBe('string');
    expect(res.body.totalsHash).toMatch(/^[0-9a-f]{64}$/);

    const after = await request(app).get(`/api/v1/pay-periods/${periodId}`).set('Cookie', admin.cookie);
    expect(after.body.status).toBe('APPROVED');
    expect(after.body.totalsHash).toBe(res.body.totalsHash);
  });

  it('refuses a second approval on an already-approved period', async () => {
    const res = await request(app)
      .post(`/api/v1/pay-periods/${periodId}/approve`)
      .send({})
      .set(withAuth(admin));
    expect(res.status).toBe(409);
  });

  it('records the approval in the audit trail (PRD §14.3)', async () => {
    const res = await request(app)
      .get('/api/v1/audit')
      .query({ q: 'APPROVE' })
      .set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    const actions = (res.body.items as Array<{ action: string }>).map((i) => i.action);
    expect(actions).toContain('PAYROLL.APPROVE');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});
