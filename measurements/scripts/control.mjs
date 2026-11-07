// Usage: node control.mjs <control.jsonl> <rps> <control-seconds>
import { readFileSync } from 'node:fs';
import { acknowledged, parseClientLog } from './client-log.mjs';

try {
  const [file, rpsArg, secondsArg] = process.argv.slice(2);
  const rps = Number(rpsArg), seconds = Number(secondsArg);
  if (!file || !Number.isInteger(rps) || rps < 1 || !Number.isInteger(seconds) || seconds < 60) {
    throw new Error('usage: node control.mjs <control.jsonl> <positive-integer-rps> <seconds>=60>');
  }
  const { rows } = parseClientLog(readFileSync(file, 'utf8'), { complete: false });
  const latencies = rows.filter(acknowledged).map(r => r.ms).sort((a, b) => a - b);
  const pct = q => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] : null;
  const result = { sent: rows.length, minimum: Math.floor(rps * seconds * 0.9), ratio: latencies.length / rows.length, p95_ms: pct(0.95), p99_ms: pct(0.99) };
  console.log(JSON.stringify(result));
  if (result.sent < result.minimum || result.ratio < 0.995 || result.p95_ms === null || result.p95_ms > 1000 || result.p99_ms > 2000) process.exitCode = 1;
} catch (error) {
  console.error(`CONTROL FAILED: ${error.message}`);
  process.exitCode = 1;
}
