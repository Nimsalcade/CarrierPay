/**
 * Audit trail (PRD §14.3). Super managers see all activity; other roles see
 * their own actions only.
 */
import { Router } from 'express';
import { ah, pagination } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';

export const auditRoutes = Router();
auditRoutes.use(requireAuth, requireCsrf);

auditRoutes.get(
  '/audit',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const where: Record<string, unknown> = {};
    if (req.user!.role !== 'SUPER_ACCOUNT_MANAGER') {
      where.actorId = req.user!.id;
    }
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : undefined;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (pg.q) where.OR = [{ action: { contains: pg.q } }, { reason: { contains: pg.q } }];

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      items: items.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        reason: row.reason,
        requestId: row.requestId,
        ipSummary: row.ipSummary,
        createdAt: row.createdAt,
        actor: row.actor,
        before: row.beforeJson ? safeParse(row.beforeJson) : null,
        after: row.afterJson ? safeParse(row.afterJson) : null,
      })),
      total,
      page: pg.page,
      pageSize: pg.pageSize,
    });
  }),
);

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
