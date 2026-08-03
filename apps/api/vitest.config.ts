import { defineConfig } from 'vitest/config';

/**
 * Unit test configuration — pure functions (money, calculator) that need no DB.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
