import { describe, expect, it } from 'vitest';
import {
  basisPointsToFraction,
  centsToDecimalString,
  dollarsToCents,
  formatBasisPoints,
  formatCents,
  formatMiles,
  milesToCents,
  milesToHundredths,
  percentOfCents,
  roundHalfUp,
  sumCents,
} from './money.js';

describe('roundHalfUp', () => {
  it('rounds half up (not banker’s) for positive values', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(roundHalfUp(7n, 2n)).toBe(4n); // 3.5 → 4
    expect(roundHalfUp(1n, 3n)).toBe(0n); // 0.333 → 0
    expect(roundHalfUp(2n, 3n)).toBe(1n); // 0.667 → 1
  });

  it('rounds half up for negative values', () => {
    expect(roundHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundHalfUp(-7n, 2n)).toBe(-4n);
  });

  it('handles exact values and zero', () => {
    expect(roundHalfUp(6n, 2n)).toBe(3n);
    expect(roundHalfUp(0n, 100n)).toBe(0n);
  });

  it('throws on a zero denominator', () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow();
  });
});

describe('percentOfCents (basis points)', () => {
  it('computes 30% of a load exactly', () => {
    expect(percentOfCents(189200, 3000)).toBe(56760); // $1,892.00 × 30%
  });

  it('reproduces the PRD golden fixture (7 loads @ 30%)', () => {
    const grosses = [189200, 188800, 189000, 189100, 189000, 189200, 188240];
    const earnings = grosses.reduce((sum, g) => sum + percentOfCents(g, 3000), 0);
    expect(earnings).toBe(396762); // $3,967.62
    expect(sumCents(grosses)).toBe(1322540); // $13,225.40
  });

  it('is not affected by binary floating-point', () => {
    // 33.33% of $1.00 must be exactly 33 cents, not 33.33→33.
    expect(percentOfCents(100, 3333)).toBe(33);
  });

  it('handles 100% and 0%', () => {
    expect(percentOfCents(123456, 10000)).toBe(123456);
    expect(percentOfCents(123456, 0)).toBe(0);
  });
});

describe('milesToCents', () => {
  it('multiplies hundredths-of-a-mile by cents-per-mile', () => {
    expect(milesToCents(15000, 250)).toBe(37500); // 150.00 mi × 250¢
    expect(milesToCents(100, 250)).toBe(250); // 1.00 mi × 250¢
  });
});

describe('display helpers', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(380552)).toBe('$3,805.52');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-2500)).toBe('-$25.00');
    expect(centsToDecimalString(1322540)).toBe('13225.40');
  });

  it('parses dollar strings back to cents', () => {
    expect(dollarsToCents('$3,805.52')).toBe(380552);
    expect(dollarsToCents('1234.5')).toBe(123450);
    expect(dollarsToCents('0.01')).toBe(1);
    expect(() => dollarsToCents('abc')).toThrow();
  });

  it('converts mileage strings to hundredths', () => {
    expect(milesToHundredths('1,093.51')).toBe(109351);
    expect(milesToHundredths('150')).toBe(15000);
    expect(formatMiles(109351)).toBe('1,093.51');
  });

  it('formats basis points', () => {
    expect(formatBasisPoints(3000)).toBe('30.00%');
    expect(basisPointsToFraction(3000)).toBeCloseTo(0.3);
  });
});

describe('sumCents', () => {
  it('sums large values exactly', () => {
    expect(sumCents([1322540, 8790, 25000])).toBe(1356330);
  });
});
