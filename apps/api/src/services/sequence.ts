/**
 * Transaction-safe, never-reused number sequences (PRD §8.7).
 * Settlement: ST-{YY}{sequence:05d}; Batch: SB-{YYYY}{sequence:03d}.
 */
import { prisma } from '../lib/prisma.js';

export async function nextSequence(name: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.numberSequence.findUnique({ where: { name } });
    if (!row) {
      await tx.numberSequence.create({ data: { name, currentValue: 1 } });
      return 1;
    }
    await tx.numberSequence.update({ where: { name }, data: { currentValue: row.currentValue + 1 } });
    return row.currentValue + 1;
  });
}

export interface Numbering {
  settlementPrefix: string;
  settlementPadding: number;
  batchPrefix: string;
  batchPadding: number;
}

export async function nextSettlementNumber(num: Numbering, now = new Date()): Promise<string> {
  const seq = await nextSequence('settlement');
  const yy = String(now.getUTCFullYear()).slice(-2);
  return `${num.settlementPrefix}${yy}${String(seq).padStart(num.settlementPadding, '0')}`;
}

export async function nextBatchNumber(num: Numbering, now = new Date()): Promise<string> {
  const seq = await nextSequence('batch');
  const yyyy = String(now.getUTCFullYear());
  return `${num.batchPrefix}${yyyy}${String(seq).padStart(num.batchPadding, '0')}`;
}
