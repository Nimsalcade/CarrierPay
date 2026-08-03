/**
 * Restore helper — restores a CarrierPay backup.
 *
 * Run with:  npm run restore -- <backup-folder-or-file>
 *
 * Examples:
 *   npm run restore -- storage/backups/backup-2026-08-03T12-00-00
 *   npm run restore -- storage/backups/backup-2026-08-03T12-00-00/carrierpay.db
 *
 * The current database is moved aside (not deleted) before the backup is
 * restored, and paystub PDFs from the backup are copied back into storage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const STORAGE = path.join(REPO_ROOT, 'storage');
const DB_DIR = path.join(STORAGE, 'database');
const DB_FILE = path.join(DB_DIR, 'carrierpay.db');

function main(): void {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Usage: npm run restore -- <backup-folder-or-file>');
    console.error('  npm run restore -- storage/backups/backup-2026-08-03T12-00-00');
    process.exitCode = 1;
    return;
  }

  const input = path.resolve(REPO_ROOT, arg);
  let srcDb: string;
  let srcDir: string;

  if (fs.statSync(input).isDirectory()) {
    srcDir = input;
    srcDb = path.join(input, 'carrierpay.db');
  } else {
    srcDir = path.dirname(input);
    srcDb = input;
  }

  if (!fs.existsSync(srcDb)) {
    console.error(`No carrierpay.db found at ${srcDb}.`);
    process.exitCode = 1;
    return;
  }

  // Move the current DB aside so a botched restore never loses it.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trashDir = path.join(STORAGE, 'backups', `pre-restore-${stamp}`);
  fs.mkdirSync(trashDir, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    fs.copyFileSync(DB_FILE, path.join(trashDir, 'carrierpay.db'));
    for (const suffix of ['-wal', '-shm']) {
      const f = `${DB_FILE}${suffix}`;
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(trashDir, `carrierpay.db${suffix}`));
    }
    console.log(`Current database preserved at ${path.join(trashDir, 'carrierpay.db')}`);
  }

  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.copyFileSync(srcDb, DB_FILE);

  // Restore paystub PDFs if the backup carried them.
  const pdfs = fs.readdirSync(srcDir).filter((f) => f.endsWith('.pdf'));
  const paystubDir = path.join(STORAGE, 'paystubs');
  fs.mkdirSync(paystubDir, { recursive: true });
  for (const f of pdfs) fs.copyFileSync(path.join(srcDir, f), path.join(paystubDir, f));

  console.log(`\nRestored ${srcDb} → ${DB_FILE}`);
  console.log(`  ${pdfs.length} paystub PDF(s) restored.`);
  console.log('Restart the API (the old WAL files must not be mixed with the restored database).');
}

main();
