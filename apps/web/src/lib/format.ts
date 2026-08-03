/** Display helpers shared across the web app. */
import { centsToDecimalString, formatCents } from '@carrierpay/shared';

export { centsToDecimalString, formatCents };

export function money(cents: number): string {
  return formatCents(cents);
}

export function moneySigned(cents: number): string {
  if (cents === 0) return '$0.00';
  return cents < 0 ? `-${formatCents(Math.abs(cents))}` : formatCents(cents);
}

export function miles(hundredths: number): string {
  return (hundredths / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(basisPoints: number | null | undefined): string {
  if (basisPoints === null || basisPoints === undefined) return '—';
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export function dt(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function initials(first: string, last: string): string {
  return `${(first[0] ?? '').toUpperCase()}${(last[0] ?? '').toUpperCase()}`;
}
