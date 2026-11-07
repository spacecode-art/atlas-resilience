import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/tabletop-sc05-sc06.mjs', import.meta.url).pathname;
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

test('synthetic SC-05/SC-06 tabletop produces bounded evidence', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-tabletop-'));
  try {
    const result = spawnSync(process.execPath, [script, '--output', dir], { encoding: 'utf8', env });
    if (result.error?.code === 'EPERM') {
      t.skip('sandbox blocks the disposable git subprocess; CI executes this fixture normally');
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json')));
    const sc05 = JSON.parse(readFileSync(join(dir, 'sc05-result.json')));
    const sc06 = JSON.parse(readFileSync(join(dir, 'sc06-scan.json')));
    assert.equal(summary.status, 'passed');
    assert.equal(sc05.oldKeyProbe, 'denied');
    assert.equal(sc05.replacementForbiddenProbe, 'denied');
    assert.deepEqual(sc06.leakedInArchive, []);
    assert.equal(sc06.tokenValuesRecorded, false);
    assert.match(sc06.detector, /local regex/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
