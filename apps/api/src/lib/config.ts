/**
 * Runtime configuration (PRD §9.4). Business settings live in SQLite; these
 * are process-level operational settings.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src/lib -> repo root
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === '1' || v === 'true';
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3001',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'carrierpay_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  storageRoot: path.resolve(process.env.STORAGE_ROOT ?? path.join(REPO_ROOT, 'storage')),
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl:
    process.env.DATABASE_URL ??
    `file:${path.join(REPO_ROOT, 'storage', 'database', 'carrierpay.db')}`,
  dbPath: path.join(REPO_ROOT, 'storage', 'database', 'carrierpay.db'),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  playrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(REPO_ROOT, 'storage', 'playwright'),
  secureCookies: bool(process.env.SECURE_COOKIES, false),
};

/** Directories the app needs at runtime. */
export const STORAGE_DIRS = [
  'database',
  'logos',
  'documents',
  'paystubs',
  'backups',
] as const;

export function storageDir(name: string): string {
  return path.join(config.storageRoot, name);
}
