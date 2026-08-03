/**
 * Backup helper — copies the SQLite database and paystub PDFs into a
 * timestamped folder under storage/backups.
 *
 * Run with:  npm run backup
 *
 * If Node >= 22.5 is available, the SQLite online backup API is used to take a
 * consistent snapshot even while the server is running. Otherwise it falls back
 * to a plain file copy (stop the API before backing up for a guaranteed
 * consistent database).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const STORAGE = path.join(REPO_ROOT, 'storage');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destDir = path.join(STORAGE, 'backups', `backup-${stamp}`);

async function main(): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });

  const dbDir = path.join(STORAGE, 'database');
  const dbFile = path.join(dbDir, 'carrierpay.db');

  if (!fs.existsSync(dbFile)) {
    console.error(`No database found at ${dbFile} — nothing to back up.`);
    process.exitCode = 1;
    return;
  }

  const destDb = path.join(destDir, 'carrierpay.db');
  let consistent = false;

  // Try the SQLite online backup API (Node >= 22.5).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = await import('node:sqlite') as { DatabaseSync: new (p: string, o?: { open?: boolean }) => { backup: (d: unknown) => { step: (n: number) => unknown } } };
    const src = new DatabaseSync(dbFile, { open: true });
    const dst = new DatabaseSync(destDb, { open: true });
    src.backup(dst).step(-1);
    consistent = true;
  } catch {
    // Node < 22.5 or node:sqlite unavailable → plain copy.
    fs.copyFileSync(dbFile, destDb);
  }

  // Copy residual WAL/SHM files (only meaningful for a plain-copy backup).
  if (!consistent) {
    for (const suffix of ['-wal', '-shm']) {
      const f = path.join(dbDir, `carrierpay.db${suffix}`);
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(destDir, `carrierpay.db${suffix}`));
    }
  }

  // Paystub PDFs.
  const paystubs = path.join(STORAGE, 'paystubs');
  if (fs.existsSync(paystubs)) {
    const pdfs = fs.readdirSync(paystubs).filter((f) => f.endsWith('.pdf'));
    for (const f of pdfs) fs.copyFileSync(path.join(paystubs, f), path.join(destDir, f));
    console.log(`  ${pdfs.length} paystub PDF(s)`);
  }

  console.log(`\nBackup complete: ${destDir}`);
  console.log(`  database: ${consistent ? 'consistent snapshot (SQLite backup API)' : 'plain file copy (stop the API for consistency)'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
