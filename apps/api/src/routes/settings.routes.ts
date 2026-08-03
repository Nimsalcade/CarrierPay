/**
 * Company settings (PRD §6.10). Super manages; assistants may view.
 * Note: changing `timezone` / `weekStartDay` / `payrollTriggerCron` takes
 * effect for the scheduler within the hourly settings re-sync window.
 */
import { Router } from 'express';
import { UserRole, companySettingsSchema } from '@carrierpay/shared';
import { ah, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf, requireRole } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';

export const settingsRoutes = Router();
settingsRoutes.use(requireAuth, requireCsrf);

const SETTING_KEYS = [
  'companyName',
  'legalName',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'timezone',
  'weekStartDay',
  'payrollTriggerCron',
  'goLiveDate',
  'settlementPrefix',
  'settlementPadding',
  'batchPrefix',
  'batchPadding',
  'separateReimbursements',
  'createZeroPayEntries',
  'prorateAssistantPay',
] as const;

settingsRoutes.get(
  '/settings',
  ah(async (req: AuthedRequest, res) => {
    const role = req.user!.role as UserRole;
    if (role !== UserRole.SUPER_ACCOUNT_MANAGER && role !== UserRole.ASSISTANT_ACCOUNT_MANAGER) throw forbidden();
    const settings = await prisma.companySettings.findFirst();
    if (!settings) throw notFound('SETTINGS_NOT_FOUND', 'Run initial setup first.');
    res.json(settings);
  }),
);

settingsRoutes.patch(
  '/settings',
  requireRole(UserRole.SUPER_ACCOUNT_MANAGER),
  validate({ body: companySettingsSchema }),
  ah(async (req: AuthedRequest, res) => {
    const existing = await prisma.companySettings.findFirst();
    if (!existing) throw notFound('SETTINGS_NOT_FOUND', 'Run initial setup first.');

    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      if (key in body) data[key] = body[key];
    }
    if ('goLiveDate' in body) data.goLiveDate = body.goLiveDate ? new Date(`${String(body.goLiveDate)}T12:00:00Z`) : null;

    const updated = await prisma.companySettings.update({ where: { id: existing.id }, data });
    await audit(req, {
      action: 'SETTINGS.UPDATE',
      entityType: 'company_settings',
      entityId: existing.id,
      before: { companyName: existing.companyName, timezone: existing.timezone, weekStartDay: existing.weekStartDay },
      after: { companyName: updated.companyName, timezone: updated.timezone, weekStartDay: updated.weekStartDay },
    });
    res.json(updated);
  }),
);
