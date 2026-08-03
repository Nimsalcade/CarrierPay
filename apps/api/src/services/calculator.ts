/**
 * Pure payroll calculation functions (PRD §7.4, §7.5).
 *
 * - Money is integer cents; percentages are basis points; mileage is hundredths.
 * - Each source line is rounded half-up to the nearest cent, then lines are
 *   summed. Percentages are never applied to batch totals.
 * - The golden fixture (PRD §17) is reproduced exactly by these formulas.
 */
import { CalculationMethod, PAYROLL_CALCULATOR_VERSION, PayrollCategory, percentOfCents, milesToCents, sumCents } from '@carrierpay/shared';

export interface LoadInput {
  id: string;
  loadNumber: string;
  customerName: string;
  grossRateCents: number;
  accessorialGrossCents: number | null;
  loadedMilesHundredths: number;
  emptyMilesHundredths: number;
  deliveryAt: Date;
}

export interface ComponentInput {
  id: string;
  componentType: string;
  calculationMethod: string;
  displayLabel: string | null;
  amountCents: number | null;
  rateBasisPoints: number | null;
  centsPerMile: number | null;
  thresholdCents: number | null;
  sequence: number;
}

export interface CalcLine {
  category: PayrollCategory;
  sourceType: string;
  sourceId: string | null;
  description: string;
  amountCents: number;
  ruleSetId?: string | null;
  ruleComponentId?: string;
  calculationJson: Record<string, unknown>;
}

export interface CalcResult {
  lines: CalcLine[];
  earningsCents: number;
  otherPayCents: number;
  reimbursementsCents: number;
  advancesCents: number;
  deductionsCents: number;
  grossRevenueCents: number;
  validationFlags: string[];
}

/** ROUND_HALF_UP on exact bigint arithmetic. */
export { percentOfCents, milesToCents, PAYROLL_CALCULATOR_VERSION };

/** Sum lines into category totals + net. */
export function summarizeLines(lines: CalcLine[]): CalcResult {
  let earnings = 0;
  let other = 0;
  let reimbursements = 0;
  let advances = 0;
  let deductions = 0;
  let gross = 0;
  const flags: string[] = [];

  for (const line of lines) {
    const amount = line.amountCents;
    switch (line.category) {
      case PayrollCategory.EARNING:
      case PayrollCategory.GUARANTEE_TOP_UP:
        earnings += amount;
        break;
      case PayrollCategory.OTHER_PAY:
        other += amount;
        break;
      case PayrollCategory.REIMBURSEMENT:
        reimbursements += amount;
        break;
      case PayrollCategory.ADVANCE:
        advances += amount;
        break;
      case PayrollCategory.DEDUCTION:
      case PayrollCategory.MANUAL_ADJUSTMENT:
        deductions += amount;
        break;
    }
    if (line.category === PayrollCategory.EARNING && line.sourceType === 'LOAD') {
      gross += amount;
    }
  }

  const net = earnings + other + reimbursements - advances - deductions;
  if (net < 0) flags.push('NEGATIVE_NET');
  if (net === 0) flags.push('ZERO_NET');

  return {
    lines,
    earningsCents: earnings,
    otherPayCents: other,
    reimbursementsCents: reimbursements,
    advancesCents: advances,
    deductionsCents: deductions,
    grossRevenueCents: gross,
    validationFlags: flags,
  };
}

/**
 * Compute driver earning lines from a rule set + delivered loads.
 * Returns only the EARNING category lines (load earnings + guarantee top-ups).
 */
export function computeDriverEarnings(
  ruleComponents: ComponentInput[],
  loads: LoadInput[],
): { lines: CalcLine[]; grossRevenueCents: number } {
  const lines: CalcLine[] = [];
  let grossRevenue = 0;

  for (const load of loads) {
    const comp = ruleComponents.find((c) => c.componentType === 'LOAD_EARNING');
    if (!comp) continue;
    let amount = 0;
    const json: Record<string, unknown> = { loadNumber: load.loadNumber, grossRateCents: load.grossRateCents };
    switch (comp.calculationMethod) {
      case CalculationMethod.PERCENT_OF_LOAD_GROSS: {
        const bp = comp.rateBasisPoints ?? 0;
        const base = load.grossRateCents + (load.accessorialGrossCents ?? 0);
        amount = percentOfCents(base, bp);
        json.method = 'PERCENT_OF_LOAD_GROSS';
        json.rateBasisPoints = bp;
        json.baseCents = base;
        break;
      }
      case CalculationMethod.FIXED_PER_LOAD:
        amount = comp.amountCents ?? 0;
        json.method = 'FIXED_PER_LOAD';
        json.amountCents = amount;
        break;
      case CalculationMethod.CENTS_PER_LOADED_MILE:
        amount = milesToCents(load.loadedMilesHundredths, comp.centsPerMile ?? 0);
        json.method = 'CENTS_PER_LOADED_MILE';
        json.loadedMilesHundredths = load.loadedMilesHundredths;
        json.centsPerMile = comp.centsPerMile;
        break;
      case CalculationMethod.CENTS_PER_TOTAL_MILE:
        amount = milesToCents(load.loadedMilesHundredths + load.emptyMilesHundredths, comp.centsPerMile ?? 0);
        json.method = 'CENTS_PER_TOTAL_MILE';
        json.totalMilesHundredths = load.loadedMilesHundredths + load.emptyMilesHundredths;
        json.centsPerMile = comp.centsPerMile;
        break;
      default:
        continue;
    }
    lines.push({
      category: PayrollCategory.EARNING,
      sourceType: 'LOAD',
      sourceId: load.id,
      description: `Linehaul — Load ${load.loadNumber}`,
      amountCents: amount,
      ruleComponentId: comp.id,
      calculationJson: json,
    });
    grossRevenue += load.grossRateCents + (load.accessorialGrossCents ?? 0);
  }

  // Minimum weekly guarantee (PRD §7.5): top-up after ordinary earnings.
  const guarantee = ruleComponents.find((c) => c.componentType === 'MINIMUM_WEEKLY_GUARANTEE');
  if (guarantee && guarantee.amountCents) {
    const ordinary = sumCents(lines.map((l) => l.amountCents));
    if (ordinary < guarantee.amountCents) {
      const topUp = guarantee.amountCents - ordinary;
      lines.push({
        category: PayrollCategory.GUARANTEE_TOP_UP,
        sourceType: 'GUARANTEE',
        sourceId: guarantee.id,
        description: `Minimum weekly guarantee top-up (${guarantee.displayLabel ?? 'guarantee'})`,
        amountCents: topUp,
        ruleComponentId: guarantee.id,
        calculationJson: { method: 'GUARANTEE_TOP_UP', guaranteeCents: guarantee.amountCents, ordinaryEarningsCents: ordinary },
      });
    }
  }

  return { lines, grossRevenueCents: grossRevenue };
}

/** Dispatcher commission lines from loads booked by the dispatcher. */
export function computeDispatcherEarnings(
  ruleComponents: ComponentInput[],
  loads: LoadInput[],
): { lines: CalcLine[]; grossRevenueCents: number } {
  const lines: CalcLine[] = [];
  let grossRevenue = 0;

  for (const load of loads) {
    const comp = ruleComponents.find((c) => c.componentType === 'LOAD_COMMISSION');
    if (!comp) continue;
    const gross = load.grossRateCents + (load.accessorialGrossCents ?? 0);
    grossRevenue += gross;
    let amount = 0;
    const json: Record<string, unknown> = { loadNumber: load.loadNumber };
    if (comp.calculationMethod === CalculationMethod.PERCENT_OF_BOOKED_LOAD_GROSS) {
      amount = percentOfCents(gross, comp.rateBasisPoints ?? 0);
      json.method = 'PERCENT_OF_BOOKED_LOAD_GROSS';
      json.rateBasisPoints = comp.rateBasisPoints;
      json.baseCents = gross;
    } else if (comp.calculationMethod === CalculationMethod.FIXED_PER_LOAD) {
      amount = comp.amountCents ?? 0;
      json.method = 'FIXED_PER_LOAD';
      json.amountCents = amount;
    } else {
      continue;
    }
    lines.push({
      category: PayrollCategory.EARNING,
      sourceType: 'LOAD',
      sourceId: load.id,
      description: `Commission — Load ${load.loadNumber}`,
      amountCents: amount,
      ruleComponentId: comp.id,
      calculationJson: json,
    });
  }
  return { lines, grossRevenueCents: grossRevenue };
}

/** Assistant manager earnings lines (flat weekly, per-active-driver, percent of processed payroll). */
export function computeAssistantEarnings(
  ruleComponents: ComponentInput[],
  inputs: { activeDriverCount: number; processedEarningsCents: number },
): { lines: CalcLine[] } {
  const lines: CalcLine[] = [];
  for (const comp of ruleComponents) {
    let amount = 0;
    const json: Record<string, unknown> = {};
    switch (comp.calculationMethod) {
      case CalculationMethod.FLAT_WEEKLY:
        amount = comp.amountCents ?? 0;
        json.method = 'FLAT_WEEKLY';
        json.amountCents = amount;
        break;
      case CalculationMethod.FIXED_PER_ACTIVE_DRIVER:
        amount = (comp.amountCents ?? 0) * inputs.activeDriverCount;
        json.method = 'FIXED_PER_ACTIVE_DRIVER';
        json.amountCents = comp.amountCents;
        json.activeDriverCount = inputs.activeDriverCount;
        break;
      case CalculationMethod.PERCENT_OF_PAYROLL_EARNINGS:
        amount = percentOfCents(inputs.processedEarningsCents, comp.rateBasisPoints ?? 0);
        json.method = 'PERCENT_OF_PAYROLL_EARNINGS';
        json.rateBasisPoints = comp.rateBasisPoints;
        json.baseCents = inputs.processedEarningsCents;
        break;
      default:
        continue;
    }
    lines.push({
      category: PayrollCategory.EARNING,
      sourceType: 'RULE_COMPONENT',
      sourceId: comp.id,
      description: comp.displayLabel ?? comp.calculationMethod,
      amountCents: amount,
      ruleComponentId: comp.id,
      calculationJson: json,
    });
  }
  return { lines };
}

/** Weekly base component applied to dispatcher/assistant rules. */
export function flatWeeklyLine(comp: ComponentInput): CalcLine | null {
  if (comp.calculationMethod !== CalculationMethod.FLAT_WEEKLY) return null;
  return {
    category: PayrollCategory.EARNING,
    sourceType: 'RULE_COMPONENT',
    sourceId: comp.id,
    description: comp.displayLabel ?? 'Flat weekly',
    amountCents: comp.amountCents ?? 0,
    ruleComponentId: comp.id,
    calculationJson: { method: 'FLAT_WEEKLY', amountCents: comp.amountCents },
  };
}
