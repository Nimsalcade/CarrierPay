/**
 * Money and rate representation (PRD §7.3).
 *
 * - Currency amounts are INTEGER cents.  $1,825.40 == 182540.
 * - Percentages are INTEGER basis points.  30.00% == 3000.
 * - Mileage is INTEGER hundredths of a mile.  1,093.51 == 109351.
 *
 * Payroll MUST NOT use binary floating-point for money arithmetic.
 */

const HUNDREDTH_DIVISOR = 100n;

/** Round to nearest integer using ROUND_HALF_UP on an exact bigint ratio. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('roundHalfUp: zero denominator');
  const sign = numerator < 0n ? -1n : 1n;
  const n = numerator * sign;
  const half = denominator / 2n;
  const q = (n + half) / denominator;
  return q * sign;
}

/** amountCents * rateBasisPoints / 10_000, rounded half up (PRD §7.4). */
export function percentOfCents(amountCents: number, rateBasisPoints: number): number {
  return Number(roundHalfUp(BigInt(amountCents) * BigInt(rateBasisPoints), 10000n));
}

/** milesHundredths * centsPerMile / 100, rounded half up (PRD §7.4). */
export function milesToCents(milesHundredths: number, centsPerMile: number): number {
  return Number(roundHalfUp(BigInt(milesHundredths) * BigInt(centsPerMile), 100n));
}

/** cents → display string "$1,234.56" (no negative sign folding; caller controls minus). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = `${dollars.toLocaleString('en-US')}.${remainder.toString().padStart(2, '0')}`;
  return `${sign}$${body}`;
}

/** cents → plain numeric string "1234.56". */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/** dollars string → cents, throwing on malformed input. Accepts "$1,234.56", "1234.56". */
export function dollarsToCents(input: string): number {
  const cleaned = input.replace(/[$,]/g, '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid currency value: "${input}"`);
  }
  const negative = cleaned.startsWith('-');
  const abs = cleaned.replace('-', '');
  const [whole = '0', frac = ''] = abs.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** miles decimal string → hundredths, throwing on malformed input. */
export function milesToHundredths(input: string): number {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid mileage value: "${input}"`);
  }
  const negative = cleaned.startsWith('-');
  const abs = cleaned.replace('-', '');
  const [whole = '0', frac = ''] = abs.split('.');
  const hundredths = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -hundredths : hundredths;
}

/** hundredths of a mile → display "1,093.51". */
export function formatMiles(hundredths: number): string {
  const sign = hundredths < 0 ? '-' : '';
  const abs = Math.abs(hundredths);
  const miles = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${miles.toLocaleString('en-US')}.${rem.toString().padStart(2, '0')}`;
}

/** basis points → decimal fraction, e.g. 3000 → 0.3. */
export function basisPointsToFraction(bp: number): number {
  return bp / 10000;
}

/** basis points → "30.00%" display. */
export function formatBasisPoints(bp: number): string {
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${whole}.${rem.toString().padStart(2, '0')}%`;
}

/** Sum a list of integer cents with exact bigint arithmetic; returns safe integer. */
export function sumCents(values: ReadonlyArray<number>): number {
  let total = 0n;
  for (const v of values) total += BigInt(v);
  return Number(total);
}
