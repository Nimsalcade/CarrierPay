/**
 * Verification helper — checks a CarrierPay install is healthy:
 *
 *   1. Node version, dependencies, built artifacts.
 *   2. Storage layout exists.
 *   3. Database migrated (Prisma `_prisma_migrations` table + expected tables).
 *   4. Company + users seeded.
 *   5. Golden fixture still reproduces (driver entry math).
 *
 * Run with:  npm run verify-install
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const DB_PATH = path.join(REPO_ROOT, 'storage', 'database', 'carrierpay.db');

let failures = 0;
function check(ok: boolean, label: string): void {
  if (ok) {
    console.log(`  \x1b[32m✔\x1b[0m ${label}`);
  } else {
    console.log(`  \x1b[31m✘\x1b[0m ${label}`);
    failures += 1;
  }
}

async function main(): Promise<void> {
  console.log('Verifying CarrierPay install…\n');

  // 1. Node + deps + build artifacts ----------------------------------------
  console.log('Environment:');
  const major = Number(process.versions.node.split('.')[0]);
  check(major >= 20, `Node >= 20 (found ${process.versions.node})`);
  check(fs.existsSync(path.join(REPO_ROOT, 'node_modules')), 'node_modules installed');
  check(fs.existsSync(path.join(REPO_ROOT, 'apps/api/dist/server.js')), 'API build present');
  check(fs.existsSync(path.join(REPO_ROOT, 'apps/web/dist/index.html')), 'Web build present');

  // 2. Storage layout -------------------------------------------------------
  console.log('\nStorage:');
  for (const dir of ['database', 'paystubs', 'backups', 'logos', 'documents']) {
    check(fs.existsSync(path.join(REPO_ROOT, 'storage', dir)), `storage/${dir} exists`);
  }

  // 3. Database -------------------------------------------------------------
  console.log('\nDatabase:');
  if (!fs.existsSync(DB_PATH)) {
    check(false, 'carrierpay.db exists — run `npm run setup`');
    console.log('\nVerification FAILED with', failures, 'problem(s).');
    process.exitCode = 1;
    return;
  }

  process.env.DATABASE_URL = `file:${DB_PATH}`;
  const prisma = new PrismaClient();

  const migrated = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at');
  check(migrated.length > 0, `migrations applied (${migrated.length} recorded)`);

  const company = await prisma.companySettings.findFirst();
  check(Boolean(company), 'company settings seeded');

  const users = await prisma.user.count();
  check(users >= 4, `users seeded (${users})`);

  // 4. Golden fixture -------------------------------------------------------
  console.log('\nGolden fixture (PRD §17):');
  const driver = await prisma.user.findUnique({ where: { employeeCode: 'DRV001' } });
  if (!driver) {
    check(false, 'driver DRV001 present');
  } else {
    const periods = await prisma.payPeriod.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { entries: { where: { userId: driver.id } } },
      orderBy: { endAt: 'desc' },
      take: 1,
    });
    const entry = periods[0]?.entries[0];
    if (!entry) {
      check(false, 'driver has a calculated payroll entry');
    } else {
      const expected = { gross: 1322540, earnings: 396762, reimb: 8790, deduct: 25000, net: 380552 };
      const ok =
        entry.grossRevenueCents === expected.gross &&
        entry.earningsCents === expected.earnings &&
        entry.reimbursementsCents === expected.reimb &&
        entry.deductionsCents === expected.deduct &&
        entry.netPayCents === expected.net;
      check(ok, 'driver entry matches PRD golden numbers (30% linehaul on 7 loads)');
      if (!ok) {
        console.log(`         got: gross=${entry.grossRevenueCents} earnings=${entry.earningsCents} reimb=${entry.reimbursementsCents} deduct=${entry.deductionsCents} net=${entry.netPayCents}`);
      }
    }
  }

  await prisma.$disconnect();

  console.log('\n' + (failures === 0 ? '✅ Installation is healthy.' : `❌ ${failures} problem(s) found. Run \`npm run setup\` and retry.`));
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
