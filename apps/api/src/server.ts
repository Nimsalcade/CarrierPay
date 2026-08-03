import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createApp } from './app.js';
import { config, STORAGE_DIRS } from './lib/config.js';
import { logger } from './lib/logger.js';
import { prisma, configurePragmas } from './lib/prisma.js';
import { startScheduler, runStartupReconciliation } from './jobs/scheduler.js';

async function bootstrap(): Promise<void> {
  for (const dir of STORAGE_DIRS) {
    fs.mkdirSync(path.join(config.storageRoot, dir), { recursive: true });
  }

  await configurePragmas();
  const app = createApp();

  // Serve built web assets in production (single-process local deployment).
  if (config.isProduction) {
    const webDist = path.resolve(import.meta.dirname, '../../web/dist');
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(webDist, 'index.html'));
      });
    }
  }

  const server = app.listen(config.port, config.host, () => {
    logger.info(`CarrierPay API listening on http://${config.host}:${config.port}`);
  });

  // Startup catch-up reconciliation (PRD §13.2): missed payroll windows.
  await runStartupReconciliation().catch((err) => {
    logger.error({ err }, 'startup reconciliation failed');
  });
  startScheduler();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      server.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
