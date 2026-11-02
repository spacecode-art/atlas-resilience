import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClientLog } from '../measurements/scripts/client-log.mjs';
import { uuid, requests, clientText, cli, saveRun } from './helpers/client-fixture.mjs';

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-measurement-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true }); }
}
test('the complete recorded SC-01 result still reports 60 s and matches 5,480 sale UUIDs', () => {
  const parsed = parseClientLog(readFileSync('measurements/results/sc01c3/client.jsonl', 'utf8'));
  assert.equal(parsed.rows.length, 5550);
  const windows = cli('measurements/scripts/windows.mjs', ['measurements/results/sc01c3']);
  assert.ifError(windows.error); assert.equal(windows.status, 0, windows.stderr);
  assert.match(windows.stdout, /RTO: 60 s/);
  const result = cli('measurements/scripts/reconcile.mjs', ['measurements/results/sc01c3/client.jsonl', 'measurements/results/sc01c3/ledger.json']);
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).clean_success, 5480);
});
test('truncation, fabricated success, duplicate tags and inconsistent summary fail closed', () => {
  const rows = requests(2), good = clientText(rows);
  assert.throws(() => parseClientLog(rows.map(JSON.stringify).join('\n')), /missing final summary/);
  assert.throws(() => parseClientLog(good + '{'), /invalid JSON|final client record/);
  assert.throws(() => parseClientLog(clientText([rows[0], rows[0]])), /duplicate client tag/);
  assert.throws(() => parseClientLog(good.replace('"sales_ok":2', '"sales_ok":1')), /summary sales_ok/);
  assert.throws(() => parseClientLog(clientText([{ ...rows[0], saleId: undefined }])), /success without/);
  assert.throws(() => parseClientLog(clientText([rows[1]])), /request sequence/);
  assert.throws(() => parseClientLog(good.replace('"summary":true', '"summary":true,"rps":5,"duration_s":30')), /complete planned load/);
  assert.throws(() => parseClientLog(clientText([{ ...rows[0], ms: -1 }])), /invalid timing/);
});
test('partial control data is accepted only through the explicit partial-log mode', () => {
  const text = requests(3).map(JSON.stringify).join('\n');
  assert.throws(() => parseClientLog(text), /missing final summary/);
  assert.equal(parseClientLog(text, { complete: false }).rows.length, 3);
});
test('DB-ready recovery uses its own 30 s grid, not subtraction from fault RTO', () => temporary(dir => {
  saveRun(dir, requests(180, i => i >= 120), '2026-11-02T00:01:40Z DB_READY\n');
  const result = cli('measurements/scripts/windows.mjs', [dir]);
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RTO: 120 s/);
  assert.match(result.stdout, /DB-ready RTO: 30 s/);
}));
test('a sparse interior window cannot disappear from the RTO calculation', () => temporary(dir => {
  const rows = requests(90).map((r, i) => ({ ...r, ts: new Date(Date.parse(r.ts) + (i >= 30 ? 30_000 : 0)).toISOString() }));
  saveRun(dir, rows);
  const result = cli('measurements/scripts/windows.mjs', [dir]);
  assert.ifError(result.error); assert.equal(result.status, 2);
  assert.match(result.stderr, /insufficient traffic/);
}));
test('a partial tail cannot establish recovery and can refute an earlier healthy window', () => temporary(dir => {
  saveRun(dir, requests(20));
  let result = cli('measurements/scripts/windows.mjs', [dir]);
  assert.ifError(result.error); assert.match(result.stdout, /not recovered in complete observed windows/);
  saveRun(dir, requests(45, i => i < 30));
  result = cli('measurements/scripts/windows.mjs', [dir]);
  assert.ifError(result.error); assert.match(result.stdout, /not recovered in complete observed windows/);
}));
for (const [name, ledger, code, field, count] of [
  ['clean outcomes', [{ mpesa_ref: 'lg-test-00000', rows: 1, sale_ids: [uuid(1)] }], 0, 'clean_success', 1],
  ['missing acknowledgement', [], 1, 'acknowledged_missing_or_mismatched', 1],
  ['wrong acknowledged UUID', [{ mpesa_ref: 'lg-test-00000', rows: 1, sale_ids: [uuid(9)] }], 1, 'acknowledged_missing_or_mismatched', 1],
  ['duplicate sale tag', [{ mpesa_ref: 'lg-test-00000', rows: 2, sale_ids: [uuid(1), uuid(9)] }], 1, 'duplicate_tags', 1],
  ['lost response', [{ mpesa_ref: 'lg-test-00000', rows: 1, sale_ids: [uuid(1)] }, { mpesa_ref: 'lg-test-00001', rows: 1, sale_ids: [uuid(2)] }], 0, 'lost_response', 1],
  ['unmatched database tag', [{ mpesa_ref: 'lg-test-00000', rows: 1, sale_ids: [uuid(1)] }, { mpesa_ref: 'lg-test-00009', rows: 1, sale_ids: [uuid(9)] }], 1, 'unmatched_database_tags', 1],
]) {
  test(`ledger reconciliation: ${name}`, () => temporary(dir => {
    saveRun(dir, requests(2, i => i === 0)); writeFileSync(join(dir, 'ledger.json'), JSON.stringify(ledger));
    const result = cli('measurements/scripts/reconcile.mjs', [join(dir, 'client.jsonl'), join(dir, 'ledger.json')]);
    assert.ifError(result.error); assert.equal(result.status, code, result.stderr);
    assert.equal(JSON.parse(result.stdout)[field], count);
  }));
}
test('ledger counts alone do not prove acknowledgement UUIDs match', () => temporary(dir => {
  saveRun(dir, requests(2)); writeFileSync(join(dir, 'ledger.json'), JSON.stringify([{ mpesa_ref: 'lg-test-00000', rows: 1 }]));
  const result = cli('measurements/scripts/reconcile.mjs', [join(dir, 'client.jsonl'), join(dir, 'ledger.json')]);
  assert.ifError(result.error); assert.equal(result.status, 2); assert.match(result.stderr, /invalid ledger row/);
}));

for (const [name, rows, code] of [
  ['healthy control', requests(600), 0],
  ['insufficient volume', requests(100), 1],
  ['HTTP 200 business failures', requests(600, i => i >= 10).map(r => ({ ...r, status: 200 })), 1],
  ['excessive latency', requests(600).map(r => ({ ...r, ms: 2500 })), 1],
]) {
  test(`control gate: ${name}`, () => temporary(dir => {
    writeFileSync(join(dir, 'control.jsonl'), rows.map(JSON.stringify).join('\n'));
    const result = cli('measurements/scripts/control.mjs', [join(dir, 'control.jsonl'), '5', '120']);
    assert.ifError(result.error); assert.equal(result.status, code, result.stderr);
  }));
}
