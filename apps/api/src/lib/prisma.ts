/**
 * Prisma client singleton. Ensures the SQLite database file lives under the
 * configured storage root regardless of the process working directory.
 */
import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

if (!process.env.DATABASE_URL) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  process.env.DATABASE_URL = `file:${config.dbPath}`;
}

export const prisma = new PrismaClient();

/** Enable SQLite WAL + foreign keys + busy timeout (PRD §10.1). */
export async function configurePragmas(): Promise<void> {
  // PRAGMA statements return result rows in SQLite, so they must run through
  // $queryRawUnsafe (execute rejects any query that returns results).
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
}

export function healthCheck(): Promise<boolean> {
  return prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
}
