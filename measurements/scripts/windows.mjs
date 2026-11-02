// Per-window success ratio and RTO for a loadgen run (definition: docs/slo-rto-rpo.md sections 2 and 7).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node windows.mjs <results-dir>"); process.exit(2); }
const WINDOW_MS = 30_000, SLO = 0.995, MIN_N = 20;

const lines = (f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean);
const events = lines("events.log");
const at = (re) => { const l = events.find((x) => re.test(x)); return l ? Date.parse(l.split(" ")[0]) : NaN; };
if (events.some(line => / WARN .*recovery numbers are not trustworthy| WARN loadgen job not complete/.test(line))) {
  throw new Error("invalid run: recovery or load completion was not verified; RTO cannot be measured");
}
const fault = at(/ FAULT /);
const restore = at(/ RESTORE docker start \S+$/);
if (Number.isNaN(fault)) throw new Error("no FAULT line in events.log");

const rows = lines("client.jsonl").flatMap((l) => {
  try { const r = JSON.parse(l); return r.tag ? [r] : []; } catch { return []; }
});
if (rows.length === 0) throw new Error("no request rows in client.jsonl; run is invalid, RTO cannot be measured");
if (rows.some(r => typeof r.ok !== "boolean")) throw new Error("sale outcomes were not validated; legacy HTTP-only data cannot establish sale RTO");
// ts is completion time; a timed-out request completes ~30 s after it was sent.
for (const r of rows) r.sent = Date.parse(r.ts) - r.ms;

const win = new Map();
for (const r of rows) {
  const k = Math.floor((r.sent - fault) / WINDOW_MS);
  const w = win.get(k) ?? { n: 0, ok: 0 };
  w.n++; if (r.status === 200 && r.ok === true) w.ok++;
  win.set(k, w);
}
const ks = [...win.keys()].filter((k) => win.get(k).n >= MIN_N).sort((a, b) => a - b);

console.log("offset_s    sent    ok   ratio");
for (const k of ks) {
  const { n, ok } = win.get(k);
  const ratio = ok / n;
  console.log(`${String(k * 30).padStart(8)} ${String(n).padStart(7)} ${String(ok).padStart(5)}  ${(ratio * 100).toFixed(2)}%${ratio < SLO ? "  < SLO" : ""}`);
}

let rtoK = null;
for (let i = ks.length - 1; i >= 0 && ks[i] >= 0; i--) {
  const w = win.get(ks[i]);
  if (w.ok / w.n >= SLO) rtoK = ks[i]; else break;
}
console.log(`\nRTO: ${rtoK === null ? "not recovered" : `${rtoK * 30} s (window start, resolution 30 s)`}`);

const bad = rows.filter((r) => !(r.status === 200 && r.ok === true));
const by = {};
for (const r of bad) { const key = `${r.status}${r.err ? " " + r.err : ""}`; by[key] = (by[key] ?? 0) + 1; }
const rel = (t) => Math.round((t - fault) / 1000);
console.log(`sent ${rows.length}, failed sales ${bad.length}`, by);
if (bad.length) {
  const ms = bad.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`failed latency ms: min ${ms[0]}, median ${ms[ms.length >> 1]}, max ${ms[ms.length - 1]}`);
  console.log(`first failure at ${rel(Math.min(...bad.map((r) => r.sent)))} s, last at ${rel(Math.max(...bad.map((r) => r.sent)))} s (relative to fault)`);
  if (!Number.isNaN(restore)) console.log(`failures sent after restore: ${bad.filter((r) => r.sent >= restore).length}`);
}