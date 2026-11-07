import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseOutage } from '../scripts/lib/sc02-lifecycle.mjs';

function fixture(failure) {
  const calls = [], attempts = {};
  const action = name => async () => {
    calls.push(name); attempts[name] = (attempts[name] ?? 0) + 1;
    if (failure?.name === name && (failure.always || attempts[name] === 1)) throw new Error(`${name} failed`);
  };
  return { calls, options: { stop: action('stop'), start: action('start'), ready: action('ready'), hold: action('hold'), observe: action('observe'), log: message => calls.push(message) } };
}
test('normal outage restores before DB_READY and recovery observation', async () => {
  const f = fixture(); await databaseOutage(f.options);
  assert.deepEqual(f.calls.filter(c => ['stop', 'start', 'ready', 'hold', 'observe'].includes(c)), ['stop', 'hold', 'start', 'ready', 'observe']);
  assert.ok(f.calls.indexOf('ready') < f.calls.indexOf('DB_READY'));
  assert.ok(f.calls.indexOf('DB_READY') < f.calls.indexOf('observe'));
});
for (const name of ['stop', 'hold', 'start', 'ready']) {
  test(`${name} failure attempts restoration and does not fabricate a measurement`, async () => {
    const f = fixture({ name }); await assert.rejects(databaseOutage(f.options), new RegExp(`${name} failed`));
    assert.ok(f.calls.includes('DB_RESTORED_AFTER_ABORT'));
    assert.ok(!f.calls.includes('RECOVERY_OBSERVATION_COMPLETE'));
    assert.ok(!f.calls.includes('observe'));
  });
}
test('cleanup failure is surfaced instead of silently claiming restoration', async () => {
  const f = fixture({ name: 'start', always: true });
  await assert.rejects(databaseOutage(f.options), /start failed/);
  assert.ok(!f.calls.includes('DB_RESTORED_AFTER_ABORT'));
});
test('an interrupted recovery keeps an already restored DB running', async () => {
  const f = fixture({ name: 'observe' }); await assert.rejects(databaseOutage(f.options), /observe failed/);
  assert.equal(f.calls.filter(c => c === 'start').length, 1);
  assert.ok(!f.calls.includes('RECOVERY_OBSERVATION_COMPLETE'));
});

test('failed event storage after stop still restores even when cleanup cannot log', async () => {
  const calls = [];
  await assert.rejects(databaseOutage({
    log: message => { if (!message.startsWith('FAULT ')) throw new Error('event storage failed'); },
    stop: async () => calls.push('stop'), start: async () => calls.push('start'),
    ready: async () => calls.push('ready'), hold: async () => calls.push('hold'), observe: async () => calls.push('observe'),
  }), /event storage failed/);
  assert.deepEqual(calls, ['stop', 'start', 'ready']);
});
