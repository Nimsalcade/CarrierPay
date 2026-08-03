import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const TEST_DB = path.join(REPO_ROOT, 'storage', 'database', 'carrierpay-test.db');

/**
 * End-to-end / integration configuration.
 *
 * A dedicated temp SQLite database (carrierpay-test.db) is migrated and seeded
 * by global-setup.ts, then injected into every worker via `env`. `fileParallelism:
 * false` keeps the single temp database from being poked by concurrent workers.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: './tests/global-setup.ts',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: `file:${TEST_DB}`,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
