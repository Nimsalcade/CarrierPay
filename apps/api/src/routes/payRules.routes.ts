/**
 * Versioned, effective-dated pay rules (PRD §6.5).
 */
import { Router } from 'express';
import {
  PayrollCategory,
  RuleComponentType,
  UserRole,
  formatCents,
  payRulePreviewSchema,
  payRuleSetCreateSchema,
  percentOfCents,
  milesToCents,
} from '@carrierpay/shared';
import { ah, validate } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { ComponentInput } from '../services/calculator.js';

export const payRuleRoutes = Router();
payRuleRoutes.use(requireAuth, requireCsrf);

function canManageRules(role: UserRole, targetRole: UserRole | undefined, userId: string, targetUserId: string): boolean {
  if (role === UserRole.SUPER_ACCOUNT_MANAGER) return true;
  if (role === UserRole.ASSISTANT_ACCOUNT_MANAGER) {
    if (targetRole && targetRole === UserRole.DRIVER) return true;
    if (userId === targetUserId) return true; // view own
  }
  return role === UserRole.DRIVER && userId === targetUserId;
}

payRuleRoutes.get(
  '/users/:id/pay-rules',
  ah(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    if (!canManageRules(req.user!.role as UserRole, target.role as UserRole, req.user!.id, target.id)) throw forbidden();

    const rules = await prisma.payRuleSet.findMany({
      where: { userId: target.id },
      include: { components: { orderBy: { sequence: 'asc' } } },
      orderBy: { effectiveFrom: 'desc' },
    });
    res.json(rules);
  }),
);

payRuleRoutes.post(
  '/users/:id/pay-rules',
  validate({ body: payRuleSetCreateSchema }),
  ah(async (req: AuthedRequest, res) => {
    const body = req.body as {
      userId?: string;
      name: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      notes?: string;
      components: Array<{
        componentType: string;
        calculationMethod: string;
        displayLabel?: string;
        amountCents?: number;
        rateBasisPoints?: number;
        centsPerMile?: number;
        thresholdCents?: number;
        sequence?: number;
      }>;
    };
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('USER_NOT_FOUND');
    if (!canManageRules(req.user!.role as UserRole, target.role as UserRole, req.user!.id, target.id)) throw forbidden();

    const effectiveFrom = new Date(`${body.effectiveFrom}T12:00:00Z`);
    const effectiveTo = body.effectiveTo ? new Date(`${body.effectiveTo}T12:00:00Z`) : null;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw badRequest('INVALID_RANGE', 'Effective end date cannot precede start date.');
    }

    await prisma.$transaction(async (tx) => {
      const active = await tx.payRuleSet.findMany({ where: { userId: target.id, status: 'ACTIVE' } });
      // Genuine overlap: new rule begins on/before an existing active rule's start.
      for (const rule of active) {
        if (rule.effectiveFrom >= effectiveFrom) {
          throw conflict('RULE_OVERLAP', 'A newer active rule already exists for this user. End it before back-dating a new rule.');
        }
      }
      const maxVersion = await tx.payRuleSet.aggregate({ where: { userId: target.id }, _max: { version: true } });
      const version = (maxVersion._max.version ?? 0) + 1;

      // End the current rule the day before the new rule begins (single transaction).
      const dayBefore = new Date(effectiveFrom.getTime() - 86_400_000);
      await tx.payRuleSet.updateMany({
        where: { userId: target.id, status: 'ACTIVE' },
        data: { status: 'ENDED', effectiveTo: dayBefore },
      });

      const ruleSet = await tx.payRuleSet.create({
        data: {
          userId: target.id,
          role: target.role,
          name: body.name,
          version,
          effectiveFrom,
          effectiveTo,
          status: 'ACTIVE',
          notes: body.notes || null,
          createdBy: req.user!.id,
          components: {
            create: body.components.map((c, i) => ({
              componentType: c.componentType as RuleComponentType,
              calculationMethod: c.calculationMethod,
              displayLabel: c.displayLabel || null,
              amountCents: c.amountCents ?? null,
              rateBasisPoints: c.rateBasisPoints ?? null,
              centsPerMile: c.centsPerMile ?? null,
              thresholdCents: c.thresholdCents ?? null,
              sequence: c.sequence ?? i,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'PAY_RULE.CREATE',
          entityType: 'pay_rule_set',
          entityId: ruleSet.id,
          afterJson: JSON.stringify(body),
          reason: body.notes || undefined,
          requestId: req.id == null ? undefined : String(req.id),
        },
      });
    });

    res.status(201).json({ ok: true });
  }),
);

payRuleRoutes.post(
  '/pay-rules/:id/preview',
  validate({ body: payRulePreviewSchema }),
  ah(async (req: AuthedRequest, res) => {
    const body = req.body as {
      role: UserRole;
      components: ComponentInput[];
      sampleGrossCents: number;
      sampleMilesHundredths: number;
      sampleLoadedMilesHundredths: number;
    };

    const examples: Array<Record<string, unknown>> = [];
    for (const gross of [50000, 100000, 320000]) {
      for (const comp of body.components) {
        if (comp.componentType !== 'LOAD_EARNING') continue;
        let amount = 0;
        switch (comp.calculationMethod) {
          case 'PERCENT_OF_LOAD_GROSS':
            amount = percentOfCents(gross, comp.rateBasisPoints ?? 0);
            break;
          case 'FIXED_PER_LOAD':
            amount = comp.amountCents ?? 0;
            break;
          case 'CENTS_PER_LOADED_MILE':
            amount = milesToCents(body.sampleLoadedMilesHundredths, comp.centsPerMile ?? 0);
            break;
          case 'CENTS_PER_TOTAL_MILE':
            amount = milesToCents(body.sampleMilesHundredths, comp.centsPerMile ?? 0);
            break;
        }
        examples.push({ grossCents: gross, method: comp.calculationMethod, resultCents: amount, result: formatCents(amount) });
      }
    }
    res.json({ ok: true, examples });
  }),
);

payRuleRoutes.post(
  '/pay-rules/:id/end',
  ah(async (req: AuthedRequest, res) => {
    if (req.user!.role !== UserRole.SUPER_ACCOUNT_MANAGER && req.user!.role !== UserRole.ASSISTANT_ACCOUNT_MANAGER) {
      throw forbidden();
    }
    const rule = await prisma.payRuleSet.findUnique({ where: { id: req.params.id } });
    if (!rule) throw notFound('PAY_RULE_NOT_FOUND');
    if (rule.status === 'ENDED') throw conflict('ALREADY_ENDED', 'Rule is already ended.');

    const endedAt = new Date();
    await prisma.payRuleSet.update({ where: { id: rule.id }, data: { status: 'ENDED', effectiveTo: endedAt } });
    await audit(req, { action: 'PAY_RULE.END', entityType: 'pay_rule_set', entityId: rule.id, reason: 'Rule ended' });
    res.json({ ok: true });
  }),
);
