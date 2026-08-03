/**
 * Express application assembly (PRD §9.3). All API routes live under /api/v1.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/errors.js';
import { config } from './lib/config.js';

import { authRoutes } from './routes/auth.routes.js';
import { setupRoutes } from './routes/setup.routes.js';
import { meRoutes } from './routes/me.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { equipmentRoutes } from './routes/equipment.routes.js';
import { loadRoutes } from './routes/loads.routes.js';
import { payRuleRoutes } from './routes/payRules.routes.js';
import { recurringItemRoutes } from './routes/recurringItems.routes.js';
import { payrollRoutes } from './routes/payroll.routes.js';
import { paystubRoutes } from './routes/paystubs.routes.js';
import { notificationRoutes } from './routes/notifications.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { downloadRoutes } from './routes/downloads.routes.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, _res, next) => {
    req.id = `req_${crypto.randomBytes(8).toString('hex')}`;
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id ?? crypto.randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.ip,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Development cross-origin for the Vite dev server (localhost:5173).
  if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id ?? ''));
    next();
  });

  app.use('/api/v1', healthRoutes);

  // Public routes.
  app.use('/api/v1', setupRoutes);
  app.use('/api/v1', authRoutes);

  // Authenticated feature routes.
  app.use('/api/v1', meRoutes);
  app.use('/api/v1', userRoutes);
  app.use('/api/v1', equipmentRoutes);
  app.use('/api/v1', loadRoutes);
  app.use('/api/v1', payRuleRoutes);
  app.use('/api/v1', recurringItemRoutes);
  app.use('/api/v1', payrollRoutes);
  app.use('/api/v1', paystubRoutes);
  app.use('/api/v1', notificationRoutes);
  app.use('/api/v1', auditRoutes);
  app.use('/api/v1', settingsRoutes);
  app.use('/api/v1', dashboardRoutes);
  app.use('/api/v1', downloadRoutes);

  // SPA static assets in production.
  if (config.isProduction) {
    const webDist = path.resolve(config.appBaseUrl === '' ? '' : path.join(import.meta.dirname, '../../web/dist'));
    void webDist;
  }

  app.use('/api/v1', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.', requestId: undefined } });
  });

  app.use(errorHandler);

  return app;
}
