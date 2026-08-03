/**
 * Unit tests for the pure payroll calculation functions (PRD §7.4, §7.5).
 *
 * The golden fixture (PRD §17) is reproduced here from raw inputs:
 *   7 delivered loads at 30% linehaul → Earnings $3,967.62, Gross $13,225.40.
 */
import { describe, expect, it } from 'vitest';
import {
  CalculationMethod,
  PayrollCategory,
  PayrollLineSourceType,
  percentOfCents,
} from '@carrierpay/shared';
import {
  computeAssistantEarnings,
  computeDispatcherEarnings,
  computeDriverEarnings,
  flatWeeklyLine,
  summarizeLines,
  type ComponentInput,
  type LoadInput,
} from './calculator.js';

/** PRD §17 golden-fixture gross rates (cents) for the driver's 7 loads. */
const GOLDEN_GROSSES = [189200, 188800, 189000, 189100, 189000, 189200, 188240];

function load(overrides: Partial<LoadInput> & { id: string; loadNumber: string; grossRateCents: number }): LoadInput {
  return {
    customerName: 'Acme',
    accessorialGrossCents: null,
    loadedMilesHundredths: 0,
    emptyMilesHundredths: 0,
    deliveryAt: new Date('2026-07-31T12:00:00Z'),
    ...overrides,
  };
}

/** Build the golden-fixture load set (IDs LD001…LD007). */
function goldenLoads(): LoadInput[] {
  return GOLDEN_GROSSES.map((gross, i) =>
    load({
      id: `LD00${i + 1}`,
      loadNumber: `LD-100${i + 1}`,
      grossRateCents: gross,
    }),
  );
}

function component(overrides: Partial<ComponentInput> & { id: string; componentType: string; calculationMethod: string }): ComponentInput {
  return {
    displayLabel: null,
    amountCents: null,
    rateBasisPoints: null,
    centsPerMile: null,
    thresholdCents: null,
    sequence: 0,
    ...overrides,
  };
}

describe('computeDriverEarnings', () => {
  it('reproduces the PRD golden fixture exactly (7 loads @ 30% linehaul)', () => {
    const rule = [
      component({
        id: 'RC-LINEHAUL',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.PERCENT_OF_LOAD_GROSS,
        rateBasisPoints: 3000,
      }),
    ];
    const { lines, grossRevenueCents } = computeDriverEarnings(rule, goldenLoads());

    expect(grossRevenueCents).toBe(1322540); // $13,225.40
    expect(lines).toHaveLength(7);
    const earnings = lines.reduce((sum, l) => sum + l.amountCents, 0);
    expect(earnings).toBe(396762); // $3,967.62

    // Every line is an EARNING tagged with the source load.
    for (const l of lines) {
      expect(l.category).toBe(PayrollCategory.EARNING);
      expect(l.sourceType).toBe(PayrollLineSourceType.LOAD);
      expect(l.sourceId).toMatch(/^LD00/);
      expect(l.ruleComponentId).toBe('RC-LINEHAUL');
    }
  });

  it('per-line rounding matches percentOfCents (never batch-total percentages)', () => {
    const rule = [
      component({
        id: 'RC-LINEHAUL',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.PERCENT_OF_LOAD_GROSS,
        rateBasisPoints: 3000,
      }),
    ];
    const { lines } = computeDriverEarnings(rule, goldenLoads());
    GOLDEN_GROSSES.forEach((gross, i) => {
      expect(lines[i]?.amountCents).toBe(percentOfCents(gross, 3000));
    });
  });

  it('handles accessorial gross as part of the percentage base', () => {
    const rule = [
      component({
        id: 'RC-LINEHAUL',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.PERCENT_OF_LOAD_GROSS,
        rateBasisPoints: 5000,
      }),
    ];
    const { lines, grossRevenueCents } = computeDriverEarnings(rule, [
      load({ id: 'LD1', loadNumber: 'L1', grossRateCents: 100000, accessorialGrossCents: 5000 }),
    ]);
    expect(grossRevenueCents).toBe(105000);
    expect(lines[0]?.amountCents).toBe(52500); // 50% of $1,050.00
  });

  it('supports FIXED_PER_LOAD', () => {
    const rule = [
      component({
        id: 'RC-FIXED',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.FIXED_PER_LOAD,
        amountCents: 2500,
      }),
    ];
    const { lines } = computeDriverEarnings(rule, [load({ id: 'LD1', loadNumber: 'L1', grossRateCents: 99999 })]);
    expect(lines[0]?.amountCents).toBe(2500);
  });

  it('supports CENTS_PER_LOADED_MILE using hundredths of a mile', () => {
    const rule = [
      component({
        id: 'RC-CPM',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.CENTS_PER_LOADED_MILE,
        centsPerMile: 250,
      }),
    ];
    const { lines } = computeDriverEarnings(rule, [
      load({ id: 'LD1', loadNumber: 'L1', grossRateCents: 0, loadedMilesHundredths: 15000 }),
    ]);
    expect(lines[0]?.amountCents).toBe(37500); // 150.00 mi × 250¢
  });

  it('supports CENTS_PER_TOTAL_MILE (loaded + empty)', () => {
    const rule = [
      component({
        id: 'RC-CPM',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.CENTS_PER_TOTAL_MILE,
        centsPerMile: 100,
      }),
    ];
    const { lines } = computeDriverEarnings(rule, [
      load({ id: 'LD1', loadNumber: 'L1', grossRateCents: 0, loadedMilesHundredths: 10000, emptyMilesHundredths: 2500 }),
    ]);
    expect(lines[0]?.amountCents).toBe(12500); // 125.00 mi × 100¢
  });

  it('skips loads when no LOAD_EARNING component exists', () => {
    const { lines, grossRevenueCents } = computeDriverEarnings([], goldenLoads());
    expect(lines).toHaveLength(0);
    expect(grossRevenueCents).toBe(0);
  });

  it('applies a minimum weekly guarantee top-up when ordinary earnings fall short', () => {
    const rule = [
      component({
        id: 'RC-LINEHAUL',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.PERCENT_OF_LOAD_GROSS,
        rateBasisPoints: 3000,
      }),
      component({
        id: 'RC-GUARANTEE',
        componentType: 'MINIMUM_WEEKLY_GUARANTEE',
        calculationMethod: CalculationMethod.FLAT_WEEKLY,
        amountCents: 500000, // $5,000.00 guarantee
      }),
    ];
    const { lines } = computeDriverEarnings(rule, goldenLoads());

    const earnings = lines.filter((l) => l.category === PayrollCategory.EARNING);
    const topUp = lines.find((l) => l.category === PayrollCategory.GUARANTEE_TOP_UP);
    expect(topUp).toBeDefined();
    expect(topUp?.amountCents).toBe(500000 - 396762); // $5,000.00 − $3,967.62
    expect(earnings).toHaveLength(7);
  });

  it('does not add a guarantee top-up when earnings meet the guarantee', () => {
    const rule = [
      component({
        id: 'RC-LINEHAUL',
        componentType: 'LOAD_EARNING',
        calculationMethod: CalculationMethod.PERCENT_OF_LOAD_GROSS,
        rateBasisPoints: 3000,
      }),
      component({
        id: 'RC-GUARANTEE',
        componentType: 'MINIMUM_WEEKLY_GUARANTEE',
        calculationMethod: CalculationMethod.FLAT_WEEKLY,
        amountCents: 100000, // $1,000.00 — far below earnings
      }),
    ];
    const { lines } = computeDriverEarnings(rule, goldenLoads());
    expect(lines.some((l) => l.category === PayrollCategory.GUARANTEE_TOP_UP)).toBe(false);
  });
});

describe('computeDispatcherEarnings', () => {
  it('computes 5% commission on booked load gross', () => {
    const rule = [
      component({
        id: 'RC-COMM',
        componentType: 'LOAD_COMMISSION',
        calculationMethod: CalculationMethod.PERCENT_OF_BOOKED_LOAD_GROSS,
        rateBasisPoints: 500,
      }),
    ];
    const { lines, grossRevenueCents } = computeDispatcherEarnings(rule, goldenLoads());
    expect(grossRevenueCents).toBe(1322540);
    const commission = lines.reduce((s, l) => s + l.amountCents, 0);
    expect(commission).toBe(66127); // 5% of $13,225.40
  });

  it('supports fixed commission per load', () => {
    const rule = [
      component({
        id: 'RC-COMM',
        componentType: 'LOAD_COMMISSION',
        calculationMethod: CalculationMethod.FIXED_PER_LOAD,
        amountCents: 1000,
      }),
    ];
    const { lines } = computeDispatcherEarnings(rule, [load({ id: 'LD1', loadNumber: 'L1', grossRateCents: 99999 })]);
    expect(lines[0]?.amountCents).toBe(1000);
  });
});

describe('computeAssistantEarnings', () => {
  it('pays a flat weekly base', () => {
    const rule = [
      component({
        id: 'RC-BASE',
        componentType: 'WEEKLY_BASE',
        calculationMethod: CalculationMethod.FLAT_WEEKLY,
        amountCents: 100000,
      }),
    ];
    const { lines } = computeAssistantEarnings(rule, { activeDriverCount: 4, processedEarningsCents: 396762 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.category).toBe(PayrollCategory.EARNING);
    expect(lines[0]?.sourceType).toBe(PayrollLineSourceType.RULE_COMPONENT);
    expect(lines[0]?.amountCents).toBe(100000);
  });

  it('pays per-active-driver bonus', () => {
    const rule = [
      component({
        id: 'RC-BONUS',
        componentType: 'ACTIVE_DRIVER_BONUS',
        calculationMethod: CalculationMethod.FIXED_PER_ACTIVE_DRIVER,
        amountCents: 1000,
      }),
    ];
    const { lines } = computeAssistantEarnings(rule, { activeDriverCount: 3, processedEarningsCents: 0 });
    expect(lines[0]?.amountCents).toBe(3000);
  });

  it('pays a percentage of processed payroll earnings', () => {
    const rule = [
      component({
        id: 'RC-PCT',
        componentType: 'PAYROLL_EARNINGS_PERCENT',
        calculationMethod: CalculationMethod.PERCENT_OF_PAYROLL_EARNINGS,
        rateBasisPoints: 200,
      }),
    ];
    const { lines } = computeAssistantEarnings(rule, { activeDriverCount: 0, processedEarningsCents: 396762 });
    expect(lines[0]?.amountCents).toBe(7935); // 2% of $3,967.62
  });
});

describe('flatWeeklyLine', () => {
  it('emits a RULE_COMPONENT earning line for a FLAT_WEEKLY component', () => {
    const line = flatWeeklyLine(
      component({ id: 'RC-BASE', componentType: 'WEEKLY_BASE', calculationMethod: CalculationMethod.FLAT_WEEKLY, amountCents: 90000 }),
    );
    expect(line).not.toBeNull();
    expect(line?.amountCents).toBe(90000);
    expect(line?.sourceType).toBe(PayrollLineSourceType.RULE_COMPONENT);
    expect(line?.sourceId).toBe('RC-BASE');
  });

  it('returns null for non-flat components', () => {
    expect(
      flatWeeklyLine(component({ id: 'RC-X', componentType: 'WEEKLY_BASE', calculationMethod: CalculationMethod.PERCENT_OF_PAYROLL_EARNINGS })),
    ).toBeNull();
  });
});

describe('summarizeLines', () => {
  it('totals categories and derives gross revenue from LOAD earnings', () => {
    const lines = [
      { category: PayrollCategory.EARNING, sourceType: PayrollLineSourceType.LOAD, sourceId: 'LD1', description: 'l', amountCents: 56760, calculationJson: {} },
      { category: PayrollCategory.EARNING, sourceType: PayrollLineSourceType.LOAD, sourceId: 'LD2', description: 'l', amountCents: 56640, calculationJson: {} },
      { category: PayrollCategory.EARNING, sourceType: PayrollLineSourceType.RULE_COMPONENT, sourceId: 'RC', description: 'base', amountCents: 100000, calculationJson: {} },
      { category: PayrollCategory.REIMBURSEMENT, sourceType: PayrollLineSourceType.RECURRING_ITEM, sourceId: 'R1', description: 'fuel', amountCents: 8790, calculationJson: {} },
      { category: PayrollCategory.DEDUCTION, sourceType: PayrollLineSourceType.RECURRING_ITEM, sourceId: 'R2', description: 'advance recoup', amountCents: 25000, calculationJson: {} },
    ];
    const result = summarizeLines(lines);
    expect(result.earningsCents).toBe(213400); // 56760 + 56640 + 100000
    expect(result.reimbursementsCents).toBe(8790);
    expect(result.deductionsCents).toBe(25000);
    expect(result.grossRevenueCents).toBe(113400); // only LOAD earnings
  });

  it('reproduces the golden net pay from component parts', () => {
    const lines = [
      { category: PayrollCategory.EARNING, sourceType: PayrollLineSourceType.LOAD, sourceId: 'LD1', description: 'l', amountCents: 396762, calculationJson: {} },
      { category: PayrollCategory.REIMBURSEMENT, sourceType: PayrollLineSourceType.RECURRING_ITEM, sourceId: 'R1', description: 'fuel', amountCents: 8790, calculationJson: {} },
      { category: PayrollCategory.DEDUCTION, sourceType: PayrollLineSourceType.RECURRING_ITEM, sourceId: 'R2', description: 'advance', amountCents: 25000, calculationJson: {} },
    ];
    const result = summarizeLines(lines);
    // net = earnings + reimb − deductions = 396762 + 8790 − 25000
    expect(result.earningsCents + result.reimbursementsCents - result.deductionsCents).toBe(380552); // $3,805.52
    expect(result.validationFlags).toEqual([]);
  });

  it('flags a negative net and a zero net', () => {
    const negative = summarizeLines([
      { category: PayrollCategory.EARNING, sourceType: PayrollLineSourceType.RULE_COMPONENT, sourceId: 'RC', description: 'b', amountCents: 100, calculationJson: {} },
      { category: PayrollCategory.DEDUCTION, sourceType: PayrollLineSourceType.RECURRING_ITEM, sourceId: 'R', description: 'd', amountCents: 500, calculationJson: {} },
    ]);
    expect(negative.validationFlags).toContain('NEGATIVE_NET');

    const zero = summarizeLines([]);
    expect(zero.validationFlags).toContain('ZERO_NET');
  });
});
