import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { saleResult } from '../load/sale-result.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const script = read('scripts/sc01-zone-loss.sh');

test('sale acknowledgement distinguishes real sales from HTTP 200 errors', () => {
  const baseline = JSON.parse(read('docs/evidence/baseline/base2-client.jsonl').split('\n')[0]);
  const invalid = JSON.parse(read('measurements/results/sc01c2/client.jsonl').split('\n')[0]);
  assert.equal(saleResult(baseline.body).ok, true);
  assert.deepEqual(saleResult(invalid.body), { ok: false, err: 'application error' });
  assert.equal(saleResult('not JSON').ok, false);
  assert.equal(saleResult('{"saleId":"unexpected-envelope"}').ok, false);
});

const readyBlock = script.slice(script.indexOf('if kubectl wait --for=condition=Ready "node/$VICTIM"'), script.indexOf('IP_AFTER='));
assert.ok(readyBlock.includes('recovery numbers are not trustworthy'));
for (const [status, expected] of [[0, 0], [1, 1]]) {
  test(`node-readiness exit ${status} is handled explicitly`, () => {
    const result = spawnSync('bash', ['-euc', `
      VICTIM=test-worker
      log() { printf '%s\\n' "$*"; }
      die() { exit 1; }
      kubectl() { return ${status}; }
      ${readyBlock}
      echo RECOVERY_ALLOWED
    `], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    if (status) {
      assert.match(result.stdout, /not Ready after 300s/);
      assert.doesNotMatch(result.stdout, /RECOVERY_ALLOWED/);
    } else assert.match(result.stdout, /NODE Ready/);
  });
}
const ipBlock = script.slice(script.indexOf('IP_AFTER='), script.indexOf('phase recovery'));
test('a changed node IP rejects the recovery instead of continuing', () => {
  const result = spawnSync('bash', ['-euc', `
    VICTIM=test-worker
    IP_BEFORE=172.21.0.3
    node_ip() { echo 172.21.0.99; }
    log() { printf '%s\\n' "$*"; }
    die() { exit 1; }
    ${ipBlock}
    echo RECOVERY_ALLOWED
  `], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /NODE IP CHANGED/);
  assert.doesNotMatch(result.stdout, /RECOVERY_ALLOWED/);
});

function analyze(rows, extraEvent = '') {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-windows-'));
  try {
    writeFileSync(join(dir, 'events.log'), `2026-11-02T00:00:00Z FAULT docker kill worker\n${extraEvent}`);
    writeFileSync(join(dir, 'client.jsonl'), rows.map(JSON.stringify).join('\n'));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // Run the analyzer as a CLI, outside the parent's test protocol.
    return spawnSync(process.execPath, [new URL('measurements/scripts/windows.mjs', root).pathname, dir], { encoding: 'utf8', env });
  } finally { rmSync(dir, { recursive: true }); }
}
const rows = Array.from({ length: 60 }, (_, i) => ({
  tag: `lg-test-${i}`, ts: new Date(Date.UTC(2026, 10, 2) + i * 1000 + 100).toISOString(),
  ms: 100, status: 200, ok: i >= 30,
  ...(i >= 30 ? { saleId: '355d9ab9-541d-40da-a764-28dff1d8c525' } : {}),
}));
test('HTTP 200 business failures count against RTO', () => {
  const result = analyze(rows);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RTO: 30 s/);
  assert.match(result.stdout, /failed sales 30/);
});
test('empty and legacy HTTP-only request data cannot establish sale RTO', () => {
  const empty = analyze([]); assert.ifError(empty.error);
  assert.match(empty.stderr, /no request rows/);
  const legacy = rows.map(({ ok, ...row }) => row);
  const result = analyze(legacy); assert.ifError(result.error);
  assert.match(result.stderr, /legacy HTTP-only/);
});
for (const warning of [
  'WARN worker not Ready after 300s: recovery numbers are not trustworthy',
  'WARN NODE IP CHANGED old -> new: recovery numbers are not trustworthy',
  'WARN loadgen job not complete',
]) {
  test(`analysis rejects ${warning}`, () => {
    const result = analyze(rows, `2026-11-02T00:05:00Z ${warning}\n`);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid run/);
    assert.doesNotMatch(result.stdout, /RTO:/);
  });
}
