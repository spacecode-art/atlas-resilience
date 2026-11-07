import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from './helpers/client-fixture.mjs';

function run(profile, mode = '--check', existing = false) {
  const temp = mkdtempSync(join(tmpdir(), 'atlas-preflight-'));
  const id = 't' + randomUUID().replaceAll('-', '').slice(0, 12);
  const out = join('measurements/results', id);
  if (existing) { mkdirSync(out); writeFileSync(join(out, 'events.log'), 'original evidence\n'); }
  try {
    const env = { ...process.env, RUN_ID: id, DB: 'supabase_db_fixture', LOCAL_PROJECT: 'fixture',
      ATLAS_FIXTURE_CASE: profile, ATLAS_FIXTURE_CALLS: join(temp, 'calls.jsonl'), SMOKE_DIR: join(temp, 'missing-smoke') };
    delete env.NODE_TEST_CONTEXT;
    const result = cli('--import', ['./tests/fixtures/sc02-command-stubs.mjs', 'scripts/sc02-db-loss.mjs', mode], { env });
    assert.ifError(result.error);
    const calls = existsSync(env.ATLAS_FIXTURE_CALLS) ? readFileSync(env.ATLAS_FIXTURE_CALLS, 'utf8').trim().split('\n').map(JSON.parse) : [];
    assert.ok(!calls.some(c => c.file === 'docker' && c.args.some(a => ['stop', 'start', 'rm'].includes(a))), 'no preflight may inject/restore/remove a DB');
    assert.ok(!calls.some(c => c.file === 'kubectl' && c.args.includes('create')), 'no rejected preflight may create a Job');
    if (existing) assert.equal(readFileSync(join(out, 'events.log'), 'utf8'), 'original evidence\n');
    else assert.equal(existsSync(out), false);
    return result;
  } finally { rmSync(temp, { recursive: true }); if (existing) rmSync(out, { recursive: true }); }
}
test('read-only preflight passes without creating evidence or a load Job', () => {
  const result = run('healthy'); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).preflight, 'passed');
});
for (const profile of ['wrong-project', 'active-job', 'stale-config', 'unready-pod', 'wrong-api-port']) {
  test(`preflight rejects ${profile} before any fault`, () => {
    const result = run(profile); assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout, /ABORT/);
  });
}
test('a fault run without a verified smoke is refused', () => {
  const result = run('healthy', '--run'); assert.equal(result.status, 1); assert.match(result.stdout, /ABORT/);
});
test('an existing evidence directory remains byte-for-byte unchanged', () => {
  const result = run('healthy', '--smoke', true); assert.equal(result.status, 1); assert.match(result.stdout, /EEXIST/);
});
test('mode must be explicit before any command is attempted', () => {
  const result = run('healthy', '--unknown'); assert.equal(result.status, 1); assert.match(result.stdout, /usage:/);
});
