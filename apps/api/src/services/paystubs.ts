/**
 * Paystub PDF generation, publication, and revision (PRD §8.5, §8.6).
 *
 * - Paystub HTML is rendered server-side into a Letter-size PDF via Playwright
 *   Chromium. The PDF is written under storage/paystubs and checksummed so a
 *   published paystub can be verified (PRD §8.6).
 * - Settlement numbers come from the never-reused `NumberSequence` table.
 * - Revisions keep the original settlement number and increment the version,
 *   superseding the previous paystub in the lineage.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import type { CompanySettings, Paystub } from '@prisma/client';
import { PayrollCategory, centsToDecimalString, formatDateInZone } from '@carrierpay/shared';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { nextSettlementNumber } from './sequence.js';
import { notify } from './notifications.js';
import { getCompanySettings } from './payroll.js';

const REVISION_SUFFIX = /-R\d+$/;

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PaystubHtmlInput {
  company: CompanySettings;
  user: { firstName: string; lastName: string; employeeCode: string; role: string; address?: string | null };
  period: { startAt: Date; endAt: Date; timezone: string };
  entry: {
    grossRevenueCents: number;
    earningsCents: number;
    otherPayCents: number;
    reimbursementsCents: number;
    advancesCents: number;
    deductionsCents: number;
    netPayCents: number;
  };
  lineItems: Array<{ category: string; description: string; amountCents: number }>;
  settlementNumber: string;
  version: number;
  generatedAt: Date;
  ytd?: Record<string, number> | null;
}

/** Build the printable paystub HTML (print stylesheet, no script). */
export function buildPaystubHtml(input: PaystubHtmlInput): string {
  const { company, user, period, entry, lineItems, settlementNumber, version, generatedAt, ytd } = input;

  const row = (label: string, cents: number, negative = false) => {
    const sign = negative && cents > 0 ? '-' : '';
    return `<tr><td>${escapeHtml(label)}</td><td class="num">${sign}${centsToDecimalString(cents)}</td></tr>`;
  };

  const sections = [
    { title: 'Earnings', rows: [] as string[] },
    { title: 'Other pay', rows: [] as string[] },
    { title: 'Reimbursements', rows: [] as string[] },
    { title: 'Advances', rows: [] as string[] },
    { title: 'Deductions', rows: [] as string[] },
  ];

  for (const line of lineItems) {
    const amount = Math.abs(line.amountCents);
    switch (line.category) {
      case PayrollCategory.EARNING:
      case PayrollCategory.GUARANTEE_TOP_UP:
        sections[0]?.rows.push(row(line.description, amount));
        break;
      case PayrollCategory.OTHER_PAY:
        sections[1]?.rows.push(row(line.description, amount));
        break;
      case PayrollCategory.REIMBURSEMENT:
        sections[2]?.rows.push(row(line.description, amount));
        break;
      case PayrollCategory.ADVANCE:
        sections[3]?.rows.push(row(line.description, amount));
        break;
      case PayrollCategory.DEDUCTION:
      case PayrollCategory.MANUAL_ADJUSTMENT:
      default:
        sections[4]?.rows.push(row(line.description, amount));
        break;
    }
  }

  const bodyRows = sections
    .map(
      (s) =>
        s.rows.length > 0
          ? `<tr class="section-head"><td colspan="2">${escapeHtml(s.title)}</td></tr>${s.rows.join('')}`
          : '',
    )
    .join('');

  const ytdHtml = ytd
    ? `<tr class="section-head"><td colspan="2">Year-to-date</td></tr>
       ${row('Gross revenue', ytd.grossRevenueCents ?? 0)}
       ${row('Earnings', ytd.earningsCents ?? 0)}
       ${row('Deductions', ytd.deductionsCents ?? 0)}
       ${row('Net pay', ytd.netPayCents ?? 0)}`
    : '';

  const address = user.address ? user.address.replace(/\n/g, '<br/>') : '';
  const roleLabel = user.role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a202c; margin: 0; font-size: 12px; line-height: 1.4; }
  .sheet { max-width: 100%; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a202c; padding-bottom: 10px; margin-bottom: 14px; }
  .company h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
  .company .legal { color: #4a5568; font-size: 11px; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; }
  .doc-title .settlement { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 14px; }
  .meta .k { color: #718096; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .v { font-weight: 600; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; border-bottom: 1px solid #cbd5e0; padding: 4px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #edf2f7; }
  tr.section-head td { background: #f7fafc; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 16px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; }
  .total-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #edf2f7; }
  .total-row .label { color: #4a5568; }
  .net { font-size: 16px; font-weight: 800; border: 2px solid #1a202c; padding: 8px 10px; margin-top: 8px; display: flex; justify-content: space-between; }
  .footer { margin-top: 18px; font-size: 9px; color: #a0aec0; border-top: 1px solid #e2e8f0; padding-top: 6px; text-align: center; }
</style>
</head>
<body>
<div class="sheet">
  <div class="masthead">
    <div class="company">
      <h1>${escapeHtml(company.companyName)}</h1>
      <div class="legal">${escapeHtml(company.legalName)}</div>
      ${company.addressLine1 ? `<div class="legal">${escapeHtml(company.addressLine1)}</div>` : ''}
      ${company.city ? `<div class="legal">${escapeHtml(company.city)}${company.state ? `, ${escapeHtml(company.state)}` : ''}${company.zip ? ` ${escapeHtml(company.zip)}` : ''}</div>` : ''}
    </div>
    <div class="doc-title">
      <h2>Earnings Statement</h2>
      <div class="settlement">${escapeHtml(settlementNumber)} ${version > 1 ? `· Rev ${version}` : ''}</div>
    </div>
  </div>

  <div class="meta">
    <div><div class="k">Employee</div><div class="v">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)} (${escapeHtml(user.employeeCode)})</div></div>
    <div><div class="k">Role</div><div class="v">${escapeHtml(roleLabel)}</div></div>
    <div><div class="k">Pay period</div><div class="v">${formatDateInZone(period.startAt, period.timezone)} — ${formatDateInZone(period.endAt, period.timezone)}</div></div>
    <div><div class="k">Issued</div><div class="v">${formatDateInZone(generatedAt, period.timezone)}</div></div>
    ${address ? `<div style="grid-column: span 2"><div class="k">Address</div><div class="v">${address}</div></div>` : ''}
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>${bodyRows}${ytdHtml}</tbody>
  </table>

  <div class="totals">
    <div>
      <div class="total-row"><span class="label">Gross revenue</span><span class="num">${centsToDecimalString(entry.grossRevenueCents)}</span></div>
      <div class="total-row"><span class="label">Earnings</span><span class="num">${centsToDecimalString(entry.earningsCents)}</span></div>
      <div class="total-row"><span class="label">Other pay</span><span class="num">${centsToDecimalString(entry.otherPayCents)}</span></div>
      <div class="total-row"><span class="label">Reimbursements</span><span class="num">${centsToDecimalString(entry.reimbursementsCents)}</span></div>
      <div class="total-row"><span class="label">Advances</span><span class="num">-${centsToDecimalString(entry.advancesCents)}</span></div>
      <div class="total-row"><span class="label">Deductions</span><span class="num">-${centsToDecimalString(entry.deductionsCents)}</span></div>
    </div>
    <div class="net"><span>Net pay</span><span>${centsToDecimalString(entry.netPayCents)}</span></div>
  </div>

  <div class="footer">This statement was generated electronically by CarrierPay and is valid without a signature. Verify authenticity with the published checksum.</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

/** Render HTML to a Letter-size PDF and return the file path + SHA-256. */
export async function renderHtmlToPdf(html: string, fileName: string): Promise<{ pdfPath: string; checksumSha256: string }> {
  const dir = path.join(config.storageRoot, 'paystubs');
  await fs.mkdir(dir, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = config.playrightBrowsersPath;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    const pdfPath = path.join(dir, fileName);
    await fs.writeFile(pdfPath, pdf);
    const checksumSha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    logger.info({ pdfPath, bytes: pdf.length }, 'paystub pdf rendered');
    return { pdfPath, checksumSha256 };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Record creation
// ---------------------------------------------------------------------------

export interface GeneratePaystubInput {
  entryId: string;
  actorId: string;
  company: CompanySettings;
  settlementNumber?: string;
  supersedesPaystubId?: string;
}

/** Generate a paystub PDF for an entry and persist its record (version+1). */
export async function generatePaystubRecord(input: GeneratePaystubInput): Promise<Paystub> {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id: input.entryId },
    include: { user: true, payPeriod: true, lineItems: { orderBy: { createdAt: 'asc' } } },
  });
  if (!entry) throw new Error('Payroll entry not found');

  const prev = await prisma.paystub.findFirst({ where: { payrollEntryId: entry.id }, orderBy: { version: 'desc' } });
  const version = (prev?.version ?? 0) + 1;
  const settlementNumber = input.settlementNumber ?? (await nextSettlementNumber(input.company));

  const html = buildPaystubHtml({
    company: input.company,
    user: entry.user,
    period: entry.payPeriod,
    entry,
    lineItems: entry.lineItems.map((l) => ({ category: l.category, description: l.description, amountCents: l.amountCents })),
    settlementNumber,
    version,
    generatedAt: new Date(),
    ytd: await ytdForEntry(entry.userId, entry.id),
  });

  const safeName = settlementNumber.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { pdfPath, checksumSha256 } = await renderHtmlToPdf(html, `${safeName}-v${version}.pdf`);

  return prisma.paystub.create({
    data: {
      payrollEntryId: entry.id,
      settlementNumber,
      version,
      pdfPath,
      checksumSha256,
      generatedAt: new Date(),
      generatorId: input.actorId,
      supersedesPaystubId: input.supersedesPaystubId ?? prev?.id ?? null,
    },
  });
}

async function ytdForEntry(userId: string, excludeEntryId: string): Promise<Record<string, number> | null> {
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const entries = await prisma.payrollEntry.findMany({
    where: {
      userId,
      status: { in: ['PUBLISHED'] },
      payPeriod: { is: { publishedAt: { gte: yearStart } } },
    },
  });
  const current = await prisma.payrollEntry.findUnique({ where: { id: excludeEntryId } });
  const all = current ? [...entries, current] : entries;
  if (all.length === 0) return null;
  const key = 'grossRevenueCents' as const;
  const sum = (k: 'earningsCents' | 'otherPayCents' | 'reimbursementsCents' | 'advancesCents' | 'deductionsCents' | 'netPayCents') =>
    all.reduce((s, e) => s + e[k], 0);
  return {
    grossRevenueCents: all.reduce((s, e) => s + e[key], 0),
    earningsCents: sum('earningsCents'),
    otherPayCents: sum('otherPayCents'),
    reimbursementsCents: sum('reimbursementsCents'),
    advancesCents: sum('advancesCents'),
    deductionsCents: sum('deductionsCents'),
    netPayCents: sum('netPayCents'),
  };
}

// ---------------------------------------------------------------------------
// Publication flow
// ---------------------------------------------------------------------------

export interface PublishResult {
  count: number;
  settlementRange: [string, string];
}

/**
 * Generate paystubs for every APPROVED entry in an APPROVED period, then move
 * the period to PUBLISHED, mark entries PUBLISHED, and lock the delivered
 * loads that fed the batch (PRD §8.5).
 */
export async function publishPayPeriod(periodId: string, actorId: string, entryIds?: string[]): Promise<PublishResult> {
  const period = await prisma.payPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Pay period not found');
  if (period.status !== 'APPROVED') {
    throw new Error(`Period must be APPROVED to publish, not ${period.status}.`);
  }

  const entries = await prisma.payrollEntry.findMany({
    where: { payPeriodId: periodId, status: 'APPROVED' },
    include: { user: { select: { id: true } } },
    orderBy: { user: { lastName: 'asc' } },
  });
  const targets = entryIds?.length ? entries.filter((e) => entryIds.includes(e.id)) : entries;
  if (targets.length === 0) throw new Error('No APPROVED entries to publish.');

  const company = await getCompanySettings();
  await prisma.payPeriod.update({ where: { id: periodId }, data: { status: 'GENERATING', error: null } });

  try {
    const numbers: string[] = [];
    for (const entry of targets) {
      const stub = await generatePaystubRecord({ entryId: entry.id, actorId, company });
      numbers.push(stub.settlementNumber);
    }

    await prisma.$transaction([
      prisma.payPeriod.update({ where: { id: periodId }, data: { status: 'PUBLISHED', publishedAt: new Date(), error: null } }),
      prisma.payrollEntry.updateMany({ where: { payPeriodId: periodId, status: 'APPROVED' }, data: { status: 'PUBLISHED' } }),
    ]);

    // Lock delivered loads that fed this batch so edits require a correction.
    const lineItems = await prisma.payrollLineItem.findMany({
      where: { sourceType: 'LOAD', payrollEntry: { is: { payPeriodId: periodId } } },
      select: { sourceId: true },
    });
    const loadIds = [...new Set(lineItems.map((l) => l.sourceId).filter((x): x is string => Boolean(x)))];
    if (loadIds.length > 0) {
      await prisma.load.updateMany({
        where: { id: { in: loadIds }, status: 'DELIVERED' },
        data: { status: 'PAYROLL_LOCKED', payrollLockedAt: new Date() },
      });
    }

    for (const entry of targets) {
      await notify({
        recipientUserId: entry.user.id,
        type: 'PAYSTUB_PUBLISHED',
        title: 'Paystub published',
        body: 'Your paystub is now available.',
        link: '/paystubs',
      });
    }

    return { count: targets.length, settlementRange: [numbers[0] ?? '', numbers[numbers.length - 1] ?? ''] };
  } catch (err) {
    await prisma.payPeriod
      .update({ where: { id: periodId }, data: { status: 'APPROVED', error: String((err as Error).message ?? err) } })
      .catch(() => undefined);
    throw err;
  }
}

/** Compute the revision settlement number for an entry (base + -RN). */
export async function revisionSettlementNumber(entryId: string, company: CompanySettings, version: number): Promise<string> {
  const first = await prisma.paystub.findFirst({ where: { payrollEntryId: entryId }, orderBy: { version: 'asc' } });
  const base = first?.settlementNumber.replace(REVISION_SUFFIX, '') ?? (await nextSettlementNumber(company));
  return version === 1 ? base : `${base}-R${version}`;
}
