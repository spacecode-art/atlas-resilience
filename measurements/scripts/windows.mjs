// Usage: node windows.mjs <results-dir>. Original 30 s window size and 99.5% target retained.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acknowledged, parseClientLog } from './client-log.mjs';

const WINDOW_MS = 30_000, SLO = 0.995, MIN_N = 20;

export function recoveryWindows(rows, anchor) {
  const windows = new Map();
  let lastSent = -Infinity;
  for (const row of rows) {
    lastSent = Math.max(lastSent, row.sent);
    const k = Math.floor((row.sent - anchor) / WINDOW_MS);
    const w = windows.get(k) ?? { n: 0, ok: 0 };
    w.n++; if (acknowledged(row)) w.ok++;
    windows.set(k, w);
  }
  const last = Math.floor((lastSent - anchor) / WINDOW_MS);
  const full = Math.floor((lastSent - anchor) / WINDOW_MS) - 1;
  for (let k = 0; k <= full; k++) {
    if ((windows.get(k)?.n ?? 0) < MIN_N) throw new Error(`insufficient traffic in full window at +${k * 30}s; continuity is unmeasured`);
  }
  let rto = null;
  const tail = windows.get(last);
  // A partial tail cannot establish recovery. It can contradict a prior recovery.
  const tailBad = last >= 0 && tail && tail.ok / tail.n < SLO;
  if (!tailBad) {
    for (let k = full; k >= 0; k--) {
      const w = windows.get(k);
      if (w.ok / w.n < SLO) break;
      rto = k * 30;
    }
  }
  return { windows, rto, full };
}

try {
  const dir = process.argv[2];
  if (!dir || process.argv.length !== 3) throw new Error('usage: node windows.mjs <results-dir>');
  const events = readFileSync(join(dir, 'events.log'), 'utf8').split('\n').filter(Boolean);
  if (events.some(line => / WARN .*recovery numbers are not trustworthy| WARN loadgen job not complete| INVALID | ABORT /.test(line))) {
    throw new Error('invalid run: recovery or load completion was not verified; RTO cannot be measured');
  }
  const eventTime = (pattern, required = false) => {
    const matches = events.filter(line => pattern.test(line));
    if (matches.length > 1 || (required && !matches.length)) throw new Error(`expected ${required ? 'one' : 'at most one'} ${pattern} event`);
    if (!matches.length) return null;
    const time = Date.parse(matches[0].split(' ')[0]);
    if (!Number.isFinite(time)) throw new Error('invalid event timestamp');
    return time;
  };
  const fault = eventTime(/ FAULT /, true);
  const restore = eventTime(/ RESTORE (?:docker start \S+|certificate reload \S+)$/);
  const dbReady = eventTime(/ DB_READY(?: |$)/);
  if (dbReady !== null && dbReady < fault) throw new Error('DB_READY precedes fault');
  const { rows } = parseClientLog(readFileSync(join(dir, 'client.jsonl'), 'utf8'));
  const anchors = [['fault', fault], ...(dbReady === null ? [] : [['DB-ready', dbReady]])];
  for (const [name, anchor] of anchors) {
    const { windows, rto, full } = recoveryWindows(rows, anchor);
    console.log(`\n${name}-relative windows\noffset_s    sent    ok   ratio`);
    for (const k of [...windows.keys()].sort((a, b) => a - b)) {
      const { n, ok } = windows.get(k);
      const suffix = k > full ? ' (partial; cannot establish RTO)' : '';
      console.log(`${String(k * 30).padStart(8)} ${String(n).padStart(7)} ${String(ok).padStart(5)}  ${(100 * ok / n).toFixed(2)}%${ok / n < SLO ? '  < SLO' : ''}${suffix}`);
    }
    const label = name === 'fault' ? 'RTO' : 'DB-ready RTO';
    console.log(`\n${label}: ${rto === null ? 'not recovered in complete observed windows' : `${rto} s (window start, resolution 30 s)`}`);
  }
  const bad = rows.filter(r => !acknowledged(r));
  const by = {};
  for (const r of bad) { const key = `${r.status}${r.err ? ' ' + r.err : ''}`; by[key] = (by[key] ?? 0) + 1; }
  console.log(`sent ${rows.length}, failed sales ${bad.length}`, by);
  if (bad.length) {
    const ms = bad.map(r => r.ms).sort((a, b) => a - b);
    console.log(`failed latency ms: min ${ms[0]}, median ${ms[ms.length >> 1]}, max ${ms.at(-1)}`);
    console.log(`first failure at ${Math.round((Math.min(...bad.map(r => r.sent)) - fault) / 1000)} s, last at ${Math.round((Math.max(...bad.map(r => r.sent)) - fault) / 1000)} s (relative to fault)`);
    if (restore !== null) console.log(`failures sent after restore: ${bad.filter(r => r.sent >= restore).length}`);
  }
} catch (error) {
  console.error(`INVALID MEASUREMENT: ${error.message}`);
  process.exitCode = 2;
}
