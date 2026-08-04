/**
 * Local setup helper — gets a fresh CarrierPay checkout running.
 *
 *   1. Verifies Node >= 20.
 *   2. Ensures node_modules are installed.
 *   3. Creates the storage directory layout.
 *   4. Applies the Prisma migrations to a fresh SQLite database.
 *   5. Seeds the golden-fixture demo data.
 *   6. Installs the Playwright Chromium browser used for PDF paystubs.
 *
 * Run with:  npm run setup   (or)   npx tsx scripts/setup-local.ts
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const DB_PATH = path.join(REPO_ROOT, 'storage', 'database', 'carrierpay.db');

const STORAGE_DIRS = ['database', 'logos', 'documents', 'paystubs', 'backups', 'playwright'];

const cwd = (dir = REPO_ROOT) => ({ cwd: dir, stdio: 'inherit' as const });

function step(title: string): void {
  console.log(`\n\x1b[1m▶ ${title}\x1b[0m`);
}

function run(cmd: string, opts: { cwd?: string; inherit?: boolean } = {}): string {
  const stdout = execSync(cmd, { cwd: opts.cwd ?? REPO_ROOT, stdio: opts.inherit ? 'inherit' : 'pipe' });
  return stdout.toString();
}

function main(): void {
  step('1/6  Checking Node version');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`Node ${process.versions.node} is too old. CarrierPay requires Node >= 20.`);
    process.exit(1);
  }
  console.log(`Node ${process.versions.node} OK`);

  step('2/6  Installing dependencies');
  if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules'))) {
    run('npm install', { inherit: true });
  } else {
    console.log('node_modules present — skipping install (run `npm install` to refresh).');
  }

  step('3/6  Creating storage layout');
  for (const dir of STORAGE_DIRS) {
    fs.mkdirSync(path.join(REPO_ROOT, 'storage', dir), { recursive: true });
  }
  console.log(`storage/ created under ${REPO_ROOT}/storage`);

  step('4/6  Applying database migrations');
  process.env.DATABASE_URL = `file:${DB_PATH}`;
  run('npx prisma migrate deploy', { cwd: path.join(REPO_ROOT, 'packages/prisma'), inherit: true });
  console.log('Database migrated.');

  step('5/6  Seeding golden-fixture demo data');
  run('npm run db:seed -w @carrierpay/prisma', { inherit: true });

  step('6/6  Installing Playwright Chromium (PDF paystubs)');
  const pwPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(REPO_ROOT, 'storage', 'playwright');
  process.env.PLAYWRIGHT_BROWSERS_PATH = pwPath;
  const browserDir = path.join(pwPath, '.links');
  if (fs.existsSync(browserDir)) {
    console.log('Playwright browsers already present.');
  } else {
    try {
      execFileSync('npx', ['playwright', 'install', 'chromium', '--with-deps'], { stdio: 'inherit' });
    } catch {
      try {
        execFileSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
      } catch (err) {
        console.warn('Could not install Playwright Chromium automatically. Paystub PDFs need a Chromium build.');
        console.warn((err as Error).message);
      }
    }
  }

  step('Done');
  console.log('\nCarrierPay is ready. Start it with:');
  console.log('   npm run dev            # API :3001 + Web :5173 (development)');
  console.log('   npm run build && npm start   # production (single process :3001)');
  console.log('\nOpen http://localhost:5173 in development, or http://localhost:3001 in production.');
  console.log('\nDemo logins (seeded):');
  console.log('   super      → admin      / AdminPass123!');
  console.log('   assistant  → assistant  / Assistant123!');
  console.log('   dispatcher → dispatcher / Dispatcher123!');
  console.log('   driver     → driver     / DriverPass123!');
  console.log('\nDatabase: storage/database/carrierpay.db  |  Backups: storage/backups/');
}

main();
