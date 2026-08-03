/**
 * E2E global setup — builds a fresh, migrated, seeded test database.
 *
 * The worker `env` (set in vitest.e2e.config.ts) points the app at
 * storage/database/carrierpay-test.db. Here we:
 *   1. delete any stale copy,
 *   2. apply Prisma migrations,
 *   3. run the seed, which derives the just-ended payroll window, delivers the
 *      7 golden loads, and calculates the period into PENDING_APPROVAL.
 *
 * NOTE: vitest bundles global-setup files, so `import.meta.url` points at a
 * virtual path — never derive repo paths from it. Walk up from process.cwd()
 * until the monorepo root (the dir containing packages/prisma/schema.prisma).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, 'packages', 'prisma', 'schema.prisma'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate monorepo root (no packages/prisma/schema.prisma) from ${process.cwd()}`);
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const SCHEMA = path.join(REPO_ROOT, 'packages', 'prisma', 'schema.prisma');
const SEED = path.join(REPO_ROOT, 'packages', 'prisma', 'seed.ts');
const DB_FILE = path.join(REPO_ROOT, 'storage', 'database', 'carrierpay-test.db');

function cleanDatabase(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = DB_FILE + suffix;
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
}

function run(cmd: string, args: string[], env: Record<string, string>): void {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}\n${res.stderr ?? ''}`);
  }
}

export default async function setup(): Promise<void> {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  cleanDatabase();
  const env = { DATABASE_URL: `file:${DB_FILE}` };
  run('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', SCHEMA], env);
  run('npx', ['--no-install', 'tsx', SEED], env);
  console.log(`\n✅ E2E database ready at ${DB_FILE}\n`);
}
