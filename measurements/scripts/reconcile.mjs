// Usage: node reconcile.mjs <client.jsonl> <ledger.json>
// Ledger rows: {mpesa_ref, rows, sale_ids}; export SQL lives beside this tool.
import { readFileSync } from 'node:fs';
import { acknowledged, parseClientLog, UUID } from './client-log.mjs';

try {
  const [clientFile, ledgerFile] = process.argv.slice(2);
  if (!clientFile || !ledgerFile || process.argv.length !== 4) throw new Error('usage: node reconcile.mjs <client.jsonl> <ledger.json>');
  const { rows, run } = parseClientLog(readFileSync(clientFile, 'utf8'));
  const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
  if (!Array.isArray(ledger)) throw new Error('ledger must be an array');
  const db = new Map(), ids = new Set();
  for (const entry of ledger) {
    if (typeof entry.mpesa_ref !== 'string' || !entry.mpesa_ref.startsWith(`lg-${run}-`) || db.has(entry.mpesa_ref) ||
        !Number.isInteger(entry.rows) || entry.rows < 1 || !Array.isArray(entry.sale_ids) || entry.sale_ids.length !== entry.rows) {
      throw new Error('invalid ledger row, mixed run or repeated aggregate tag');
    }
    for (const id of entry.sale_ids) {
      if (typeof id !== 'string' || !UUID.test(id) || ids.has(id)) throw new Error('invalid or repeated database sale UUID');
      ids.add(id);
    }
    db.set(entry.mpesa_ref, entry);
  }
  const tags = new Set(rows.map(r => r.tag));
  const report = {
    run, sent: rows.length, sales_ok: rows.filter(acknowledged).length,
    database_rows: ledger.reduce((n, r) => n + r.rows, 0), distinct_database_tags: db.size,
    clean_success: 0, clean_failure: 0, acknowledged_missing_or_mismatched: 0, lost_response: 0,
    duplicate_tags: ledger.filter(r => r.rows > 1).length,
    unmatched_database_tags: ledger.filter(r => !tags.has(r.mpesa_ref)).length,
  };
  for (const row of rows) {
    const entry = db.get(row.tag);
    if (acknowledged(row)) {
      if (!entry?.sale_ids.includes(row.saleId)) report.acknowledged_missing_or_mismatched++;
      else if (entry.rows === 1) report.clean_success++;
    } else if (entry) report.lost_response++;
    else report.clean_failure++;
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.acknowledged_missing_or_mismatched || report.duplicate_tags || report.unmatched_database_tags) process.exitCode = 1;
} catch (error) {
  console.error(`INVALID RECONCILIATION: ${error.message}`);
  process.exitCode = 2;
}
