import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/sc02-replay.mjs', import.meta.url).pathname;
const childEnv = () => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; };

function fixture(dir, ledgerRows) {
  const replay = {
    run: 'test',
    cases: {
      A_sequential: { responses: [{ ok: true, saleId: '00000000-0000-4000-8000-000000000001' }, { ok: true, saleId: '00000000-0000-4000-8000-000000000001' }] },
      B_concurrent: { responses: [{ ok: true, saleId: '00000000-0000-4000-8000-000000000002' }, { ok: true, saleId: '00000000-0000-4000-8000-000000000002' }] },
      C_conflicting: { responses: [{ ok: true, saleId: '00000000-0000-4000-8000-000000000003' }, { ok: false }] },
    },
  };
  const replayFile = join(dir, 'replay.json');
  const ledgerFile = join(dir, 'ledger.json');
  writeFileSync(replayFile, JSON.stringify(replay));
  writeFileSync(ledgerFile, JSON.stringify(ledgerRows));
  return [replayFile, ledgerFile];
}

test('replay verifier accepts sequential, concurrent and conflicting cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-sc02-replay-'));
  try {
    const [replay, ledger] = fixture(dir, [
      { mpesa_ref: 'lg-test-00000', rows: 1 },
      { mpesa_ref: 'lg-test-00001', rows: 1 },
      { mpesa_ref: 'lg-test-00002', rows: 1 },
    ]);
    const result = spawnSync(process.execPath, [script, '--verify', replay, ledger], { encoding: 'utf8', env: childEnv() });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /safety failures: 0, contract gaps: 0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('replay verifier rejects a duplicate ledger row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-sc02-replay-'));
  try {
    const [replay, ledger] = fixture(dir, [
      { mpesa_ref: 'lg-test-00000', rows: 2 },
      { mpesa_ref: 'lg-test-00001', rows: 1 },
      { mpesa_ref: 'lg-test-00002', rows: 1 },
    ]);
    const result = spawnSync(process.execPath, [script, '--verify', replay, ledger], { encoding: 'utf8', env: childEnv() });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /safety failures: 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
