/**
 * CarrierPay demo seed (PRD §17 golden fixture).
 *
 * Creates a complete company with one of every role, equipment, pay rules,
 * recurring items, and 7 delivered loads such that the payroll engine produces
 * the golden numbers exactly:
 *
 *   Gross        $13,225.40   (1322540 cents)
 *   Earnings     $ 3,967.62   ( 396762 cents, 30% linehaul)
 *   Reimbursements $   87.90   (   8790 cents)
 *   Deductions   $  250.00   (  25000 cents)
 *   Net pay      $ 3,805.52   ( 380552 cents)
 *
 * Idempotent: safe to run repeatedly against an existing database.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma, configurePragmas } from '../../apps/api/src/lib/prisma.js';
import { hashPassword } from '../../apps/api/src/services/password.js';
import { derivePeriod, ensurePeriod, calculatePeriod } from '../../apps/api/src/services/payroll.js';
import { centsToDecimalString } from '@carrierpay/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(REPO_ROOT, 'storage', 'database', 'carrierpay.db')}`;
}

const PASSWORDS = {
  super: 'AdminPass123!',
  assistant: 'Assistant123!',
  dispatcher: 'Dispatcher123!',
  driver: 'DriverPass123!',
} as const;

// 7 loads whose per-load 30% rounding sums exactly to 396762 cents.
const GOLDEN_LOADS: Array<{ loadNumber: string; customerName: string; grossRateCents: number }> = [
  { loadNumber: 'GOLD-001', customerName: 'Acme Logistics', grossRateCents: 189200 },
  { loadNumber: 'GOLD-002', customerName: 'Blue Ridge Foods', grossRateCents: 188800 },
  { loadNumber: 'GOLD-003', customerName: 'Summit Freight', grossRateCents: 189000 },
  { loadNumber: 'GOLD-004', customerName: 'Ironworks Inc', grossRateCents: 189100 },
  { loadNumber: 'GOLD-005', customerName: 'Pioneer Produce', grossRateCents: 189000 },
  { loadNumber: 'GOLD-006', customerName: 'Redwood Lumber', grossRateCents: 189200 },
  { loadNumber: 'GOLD-007', customerName: 'Prairie Grain', grossRateCents: 188240 },
];

async function upsertUser(input: {
  role: 'SUPER_ACCOUNT_MANAGER' | 'ASSISTANT_ACCOUNT_MANAGER' | 'DISPATCHER' | 'DRIVER';
  firstName: string;
  lastName: string;
  employeeCode: string;
  username: string;
  email: string;
  password: string;
  driverType?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { employeeCode: input.employeeCode } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      employeeCode: input.employeeCode,
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      status: 'ACTIVE',
      driverType: input.driverType,
      mustChangePassword: false,
      createdBy: 'seed',
    },
  });
}

async function main(): Promise<void> {
  await configurePragmas();
  console.log('⚙️  Seeding CarrierPay…');

  // Company ------------------------------------------------------------------
  const existingCompany = await prisma.companySettings.findFirst();
  const company =
    existingCompany ??
    (await prisma.companySettings.create({
      data: {
        companyName: 'Golden Haul LLC',
        legalName: 'Golden Haul LLC',
        addressLine1: '4800 Dock Rd',
        city: 'Dallas',
        state: 'TX',
        zip: '75201',
        phone: '555-0100',
        email: 'payroll@goldenhaul.example',
        timezone: 'America/Chicago',
        weekStartDay: 6,
        payrollTriggerCron: '0 0 * * 6',
        settlementPrefix: 'ST-',
        settlementPadding: 5,
        batchPrefix: 'SB-',
        batchPadding: 3,
      },
    }));

  // Users --------------------------------------------------------------------
  const superUser = await upsertUser({
    role: 'SUPER_ACCOUNT_MANAGER',
    firstName: 'Alex',
    lastName: 'Admin',
    employeeCode: 'ADMIN',
    username: 'admin',
    email: 'admin@goldenhaul.example',
    password: PASSWORDS.super,
  });
  const assistant = await upsertUser({
    role: 'ASSISTANT_ACCOUNT_MANAGER',
    firstName: 'Sam',
    lastName: 'Assistant',
    employeeCode: 'ASST',
    username: 'assistant',
    email: 'assistant@goldenhaul.example',
    password: PASSWORDS.assistant,
  });
  const dispatcher = await upsertUser({
    role: 'DISPATCHER',
    firstName: 'Dana',
    lastName: 'Dispatcher',
    employeeCode: 'DISP',
    username: 'dispatcher',
    email: 'dispatcher@goldenhaul.example',
    password: PASSWORDS.dispatcher,
  });
  const driver = await upsertUser({
    role: 'DRIVER',
    firstName: 'Riley',
    lastName: 'Driver',
    employeeCode: 'DRV001',
    username: 'driver',
    email: 'driver@goldenhaul.example',
    password: PASSWORDS.driver,
    driverType: 'CONTRACTOR',
  });

  // Equipment ----------------------------------------------------------------
  const truck =
    (await prisma.equipment.findFirst({ where: { unitNumber: 'TRK-001' } })) ??
    (await prisma.equipment.create({
      data: { type: 'TRUCK', unitNumber: 'TRK-001', make: 'Volvo', model: 'VNL 860', year: 2021, plate: 'TX-9912', status: 'AVAILABLE' },
    }));
  const trailer =
    (await prisma.equipment.findFirst({ where: { unitNumber: 'TRL-001' } })) ??
    (await prisma.equipment.create({
      data: { type: 'TRAILER', unitNumber: 'TRL-001', make: 'Great Dane', model: '53 ft', year: 2020, plate: 'TX-7741', status: 'AVAILABLE' },
    }));
  const openAssignment = await prisma.equipmentAssignment.findFirst({ where: { driverUserId: driver.id, returnedAt: null } });
  if (!openAssignment) {
    await prisma.equipmentAssignment.create({
      data: { equipmentId: truck.id, driverUserId: driver.id, assignedAt: new Date(), assignedBy: superUser.id, notes: 'Seeded assignment' },
    });
    await prisma.equipmentAssignment.create({
      data: { equipmentId: trailer.id, driverUserId: driver.id, assignedAt: new Date(), assignedBy: superUser.id, notes: 'Seeded assignment' },
    });
    await prisma.equipment.update({ where: { id: truck.id }, data: { status: 'ASSIGNED' } });
    await prisma.equipment.update({ where: { id: trailer.id }, data: { status: 'ASSIGNED' } });
  }

  // Pay rules ----------------------------------------------------------------
  const driverRule = await prisma.payRuleSet.findFirst({ where: { userId: driver.id, status: 'ACTIVE' } });
  if (!driverRule) {
    await prisma.payRuleSet.create({
      data: {
        userId: driver.id,
        role: 'DRIVER',
        name: '30% Linehaul',
        version: 1,
        effectiveFrom: new Date('2024-01-01T12:00:00Z'),
        status: 'ACTIVE',
        createdBy: 'seed',
        components: {
          create: [
            {
              componentType: 'LOAD_EARNING',
              calculationMethod: 'PERCENT_OF_LOAD_GROSS',
              displayLabel: 'Linehaul 30%',
              rateBasisPoints: 3000,
              sequence: 0,
            },
          ],
        },
      },
    });
  }
  const dispatcherRule = await prisma.payRuleSet.findFirst({ where: { userId: dispatcher.id, status: 'ACTIVE' } });
  if (!dispatcherRule) {
    await prisma.payRuleSet.create({
      data: {
        userId: dispatcher.id,
        role: 'DISPATCHER',
        name: '5% Commission',
        version: 1,
        effectiveFrom: new Date('2024-01-01T12:00:00Z'),
        status: 'ACTIVE',
        createdBy: 'seed',
        components: {
          create: [
            {
              componentType: 'LOAD_COMMISSION',
              calculationMethod: 'PERCENT_OF_BOOKED_LOAD_GROSS',
              displayLabel: 'Commission 5%',
              rateBasisPoints: 500,
              sequence: 0,
            },
          ],
        },
      },
    });
  }
  const assistantRule = await prisma.payRuleSet.findFirst({ where: { userId: assistant.id, status: 'ACTIVE' } });
  if (!assistantRule) {
    await prisma.payRuleSet.create({
      data: {
        userId: assistant.id,
        role: 'ASSISTANT_ACCOUNT_MANAGER',
        name: 'Flat Weekly $1,000',
        version: 1,
        effectiveFrom: new Date('2024-01-01T12:00:00Z'),
        status: 'ACTIVE',
        createdBy: 'seed',
        components: {
          create: [
            {
              componentType: 'WEEKLY_BASE',
              calculationMethod: 'FLAT_WEEKLY',
              displayLabel: 'Weekly base $1,000',
              amountCents: 100000,
              sequence: 0,
            },
          ],
        },
      },
    });
  }

  // Recurring items (reimbursement + deduction → golden fixture) -------------
  const reimburse = await prisma.recurringItem.findFirst({ where: { userId: driver.id, name: 'CELL PHONE' } });
  if (!reimburse) {
    await prisma.recurringItem.create({
      data: {
        userId: driver.id,
        itemType: 'REIMBURSEMENT',
        name: 'CELL PHONE',
        amountCents: 8790,
        recurrence: 'EVERY_PAY_PERIOD',
        intervalCount: 1,
        startDate: new Date('2024-01-01T12:00:00Z'),
        applyWhenNoEarnings: false,
        active: true,
      },
    });
  }
  const deduction = await prisma.recurringItem.findFirst({ where: { userId: driver.id, name: 'INSURANCE' } });
  if (!deduction) {
    await prisma.recurringItem.create({
      data: {
        userId: driver.id,
        itemType: 'DEDUCTION',
        name: 'INSURANCE',
        amountCents: 25000,
        recurrence: 'EVERY_PAY_PERIOD',
        intervalCount: 1,
        startDate: new Date('2024-01-01T12:00:00Z'),
        applyWhenNoEarnings: false,
        active: true,
      },
    });
  }

  // Deliver the 7 golden loads inside the just-ended payroll window ----------
  const { bounds, settings, schedulerKey } = await derivePeriod();
  console.log(`  Pay window: ${bounds.startAt.toISOString()} → ${bounds.endAt.toISOString()}`);

  const period = await ensurePeriod(bounds, settings.timezone, schedulerKey);
  const deliveryAt = new Date(bounds.startAt.getTime() + 86_400_000 * 3 + 12 * 3600_000); // mid-window

  for (const [idx, load] of GOLDEN_LOADS.entries()) {
    const existingLoad = await prisma.load.findUnique({ where: { loadNumber: load.loadNumber } });
    if (existingLoad) {
      // Re-point into the current window so the fixture reproduces on later runs.
      await prisma.load.update({
        where: { id: existingLoad.id },
        data: { pickupAt: new Date(deliveryAt.getTime() - 2 * 3600_000), deliveryAt, status: 'DELIVERED' },
      });
      continue;
    }
    await prisma.load.create({
      data: {
        loadNumber: load.loadNumber,
        bookedByUserId: dispatcher.id,
        driverUserId: driver.id,
        truckId: truck.id,
        trailerId: trailer.id,
        customerName: load.customerName,
        confirmationNumber: `CONF-${idx + 1}`,
        originFacility: 'Dallas DC',
        originCity: 'Dallas',
        originState: 'TX',
        destinationFacility: 'Houston DC',
        destinationCity: 'Houston',
        destinationState: 'TX',
        pickupAt: new Date(deliveryAt.getTime() - 2 * 3600_000),
        deliveryAt,
        grossRateCents: load.grossRateCents,
        loadedMilesHundredths: 150000 + idx * 5000,
        emptyMilesHundredths: 20000,
        status: 'DELIVERED',
        internalNotes: 'Golden fixture load',
      },
    });
  }

  // Calculate the just-ended period (fresh; the engine rebuilds entries) -----
  await calculatePeriod(period.id);

  // Report -------------------------------------------------------------------
  const batch = await prisma.payPeriod.findUnique({
    where: { id: period.id },
    include: { entries: { include: { user: true } } },
  });
  // The PRD golden fixture describes the DRIVER's pay: 7 loads at 30% linehaul.
  // Dispatcher commission and assistant base are additional, legitimate entries,
  // so we verify the driver entry against the golden numbers.
  const driverEntry = (batch?.entries ?? []).find((e) => e.user?.employeeCode === driver.employeeCode);
  const totals = driverEntry
    ? {
        grossRevenueCents: driverEntry.grossRevenueCents,
        earningsCents: driverEntry.earningsCents,
        reimbursementsCents: driverEntry.reimbursementsCents,
        deductionsCents: driverEntry.deductionsCents,
        netPayCents: driverEntry.netPayCents,
      }
    : { grossRevenueCents: 0, earningsCents: 0, reimbursementsCents: 0, deductionsCents: 0, netPayCents: 0 };

  const batchTotals = (batch?.entries ?? []).reduce(
    (acc, e) => {
      acc.grossRevenueCents += e.grossRevenueCents;
      acc.earningsCents += e.earningsCents;
      acc.netPayCents += e.netPayCents;
      return acc;
    },
    { grossRevenueCents: 0, earningsCents: 0, netPayCents: 0 },
  );

  console.log('\n✅ Seed complete.');
  console.log('   Company:', company.companyName);
  console.log('   Logins:');
  console.log(`     super      → username: admin       / ${PASSWORDS.super}`);
  console.log(`     assistant  → username: assistant   / ${PASSWORDS.assistant}`);
  console.log(`     dispatcher → username: dispatcher  / ${PASSWORDS.dispatcher}`);
  console.log(`     driver     → username: driver      / ${PASSWORDS.driver}`);
  console.log('\n   Pay period (%s) — DRIVER golden fixture (PRD §17):', batch?.status);
  console.log(`     Gross           ${centsToDecimalString(totals.grossRevenueCents)}`);
  console.log(`     Earnings        ${centsToDecimalString(totals.earningsCents)}`);
  console.log(`     Reimbursements  ${centsToDecimalString(totals.reimbursementsCents)}`);
  console.log(`     Deductions      ${centsToDecimalString(totals.deductionsCents)}`);
  console.log(`     Net pay         ${centsToDecimalString(totals.netPayCents)}`);
  console.log('   Batch (all roles):');
  console.log(`     Gross           ${centsToDecimalString(batchTotals.grossRevenueCents)}`);
  console.log(`     Earnings        ${centsToDecimalString(batchTotals.earningsCents)}`);
  console.log(`     Net pay         ${centsToDecimalString(batchTotals.netPayCents)}`);
  const expected = { gross: 1322540, earnings: 396762, reimb: 8790, deduct: 25000, net: 380552 };
  const pass =
    totals.grossRevenueCents === expected.gross &&
    totals.earningsCents === expected.earnings &&
    totals.reimbursementsCents === expected.reimb &&
    totals.deductionsCents === expected.deduct &&
    totals.netPayCents === expected.net;
  console.log(pass ? '   ✅ Golden fixture MATCHES the PRD.' : '   ⚠️  Golden fixture does not match the PRD.');
  if (!pass) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
