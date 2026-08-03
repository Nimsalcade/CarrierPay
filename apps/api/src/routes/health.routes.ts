/**
 * Health and readiness probes (PRD §9.5). Unauthenticated.
 */
import { Router } from 'express';
import { healthCheck } from '../lib/prisma.js';

export const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'carrierpay-api',
    version: '1.0.0',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get('/health/ready', async (_req, res) => {
  const db = await healthCheck();
  res.status(db ? 200 : 503).json({ ok: db, db, ready: db });
});
