/**
 * In-app notifications (PRD §6.9). Users only ever touch their own rows.
 */
import { Router } from 'express';
import { ah, pagination } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { AuthedRequest, requireAuth, requireCsrf } from '../auth/session.js';
import { notFound } from '../lib/errors.js';

export const notificationRoutes = Router();
notificationRoutes.use(requireAuth, requireCsrf);

notificationRoutes.get(
  '/notifications',
  ah(async (req: AuthedRequest, res) => {
    const pg = pagination(req);
    const where = { recipientUserId: req.user!.id };
    const [items, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      prisma.notification.count({ where }),
    ]);
    res.json({ items, total, page: pg.page, pageSize: pg.pageSize });
  }),
);

notificationRoutes.get(
  '/notifications/unread-count',
  ah(async (req: AuthedRequest, res) => {
    const count = await prisma.notification.count({ where: { recipientUserId: req.user!.id, readAt: null } });
    res.json({ count });
  }),
);

notificationRoutes.post(
  '/notifications/:id/read',
  ah(async (req: AuthedRequest, res) => {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('NOTIFICATION_NOT_FOUND');
    if (existing.recipientUserId !== req.user!.id) throw notFound('NOTIFICATION_NOT_FOUND');
    const updated = await prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: existing.readAt ?? new Date() },
    });
    res.json(updated);
  }),
);

notificationRoutes.post(
  '/notifications/read-all',
  ah(async (req: AuthedRequest, res) => {
    const result = await prisma.notification.updateMany({
      where: { recipientUserId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count });
  }),
);
