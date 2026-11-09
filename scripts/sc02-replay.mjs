#!/usr/bin/env node
// SC-02 / H4: is a repeated requestId the same sale? Black-box check of Tawira's
// idempotency contract. The load generator never retries, so nothing else tests it.
// Wire format is copied from load/loadgen.mjs (the source of truth): update both together.
//   RUN_ID=sc02idem1 TARGET_URL=http://127.0.0.1:13000 \
//     node --env-file=load/.env scripts/sc02-replay.mjs --run > measurements/results/sc02idem1/replay.json
//   (export the ledger for that RUN_ID with measurements/scripts/export-ledger.sql)
//   node scripts/sc02-replay.mjs --verify <replay.json> <ledger.json>
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { saleResult } from "../load/sale-result.mjs";
import { parseClientLog, acknowledged, UUID } from "../measurements/scripts/client-log.mjs";

const e = process.env;
const mode = process.argv[2];
const tagFor = (run, n) => `lg-${run}-${String(n).padStart(5, "0")}`;

const str = (s) => ({ t: 1, s });
const undef = { t: 2, s: 1 };
const item = (productId, quantity, i) => ({
  t: 10, i, o: 0,
  p: {
    k: ["product_id", "quantity", "selling_unit_id", "override_price"],
    v: [str(productId), { t: 0, s: quantity }, undef, undef],
  },
});
const body = (requestId, tag, productId, quantity) =>
  JSON.stringify({
    t: {
      t: 10, i: 0, o: 0,
      p: {
        k: ["data"],
        v: [{
          t: 10, i: 1, o: 0,
          p: {
            k: ["requestId", "branchId", "method", "mpesaRef", "customerName", "customerPhone", "items"],
            v: [str(requestId), str(e.BRANCH_ID), str("cash"), str(tag), undef, undef,
                { t: 9, i: 2, a: [item(productId, quantity, 3)], o: 0 }],
          },
        }],
      },
    },
    f: 63,
    m: [],
  });

async function getJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function post(token, payload) {
  return new Promise((resolve) => {
    const sent_ts = new Date().toISOString();
    const u = new URL(`${e.TARGET_URL}/_serverFn/${e.SALE_FN_ID}`);
    const request = u.protocol === "https:" ? https.request : http.request;
    const req = request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        agent: false, timeout: 30000,
        headers: {
          "content-type": "application/json",
          origin: u.origin,
          "sec-fetch-site": "same-origin",
          "x-tsr-serverfn": "true",
          accept: "application/x-tss-framed, application/x-ndjson, application/json",
          authorization: `Bearer ${token}`,
          "content-length": Buffer.byteLength(payload),
          connection: "close",
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => { if (b.length < 1_000_000) b += c; });
        res.on("end", () => resolve({ status: res.statusCode, sent_ts, ...saleResult(b), body: b.slice(0, 1000) }));
        res.on("aborted", () => resolve({ status: 0, ok: false, err: "response aborted", sent_ts }));
        res.on("error", (err) => resolve({ status: 0, ok: false, err: err.message, sent_ts }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ status: 0, ok: false, err: err.message, sent_ts }));
    req.end(payload);
  });
}

async function login() {
  for (const k of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "LOAD_EMAIL", "LOAD_PASSWORD", "TARGET_URL", "SALE_FN_ID", "BRANCH_ID"]) {
    if (!e[k]) throw new Error(`${k} is required`);
  }
  const auth = await getJson(`${e.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: e.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: e.LOAD_EMAIL, password: e.LOAD_PASSWORD }),
  });
  return auth.access_token;
}

// Resend every lost response (sale recorded, no acknowledgement) with its original
// requestId, tag and product. Runs after the fault, against a healthy system.
async function replayLost(clientFile, ledgerFile) {
  const { rows, run } = parseClientLog(readFileSync(clientFile, "utf8"));
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
  if (!Array.isArray(ledger)) throw new Error("ledger must be an array");
  const byTag = new Map(ledger.map((r) => [r.mpesa_ref, r]));
  const lost = rows.filter((r) => !acknowledged(r) && byTag.has(r.tag));
  if (!lost.length) throw new Error("no lost responses in this run; nothing to replay");
  const unusable = lost.filter((r) => !UUID.test(r.requestId ?? "") || !UUID.test(r.productId ?? ""));
  if (unusable.length) throw new Error(`${unusable.length} lost rows lack requestId/productId; this run predates replay logging`);
  const token = await login();
  const results = [];
  for (const r of lost) {
    const entry = byTag.get(r.tag);
    if (entry.rows !== 1) throw new Error(`${r.tag} has ${entry.rows} ledger rows before replay; refusing`);
    const response = await post(token, body(r.requestId, r.tag, r.productId, 1));
    results.push({ tag: r.tag, requestId: r.requestId, expectedSaleId: entry.sale_ids[0], response });
  }
  console.log(JSON.stringify({ run, replayed: results.length, results }, null, 2));
}

function verifyLost(resultsFile, ledgerFile) {
  const { run, results } = JSON.parse(readFileSync(resultsFile, "utf8"));
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
  if (!Array.isArray(ledger) || ledger.some((r) => !String(r.mpesa_ref).startsWith(`lg-${run}-`))) {
    throw new Error("ledger is not an array of rows for this run");
  }
  const rowsFor = new Map(ledger.map((r) => [r.mpesa_ref, r.rows]));
  let recovered = 0, safety = 0, gaps = 0;
  for (const { tag, expectedSaleId, response } of results) {
    const oneRow = rowsFor.get(tag) === 1;
    const wrongSale = response.ok && response.saleId !== expectedSaleId;
    if (!oneRow || wrongSale) { safety++; console.log(`FAIL  [safety] ${tag} rows=${rowsFor.get(tag) ?? 0} wrongSale=${Boolean(wrongSale)}`); }
    else if (!response.ok) { gaps++; console.log(`FAIL  [contract] ${tag} replay not acknowledged (${response.err ?? response.status})`); }
    else recovered++;
  }
  console.log(`\nreplayed ${results.length}: recovered ${recovered}, safety failures ${safety}, contract gaps ${gaps}`);
  console.log(`one local observation (run ${run}); not a general idempotency claim`);
  if (safety || gaps) process.exitCode = 1;
}

async function runCases() {
  const runId = e.RUN_ID;
  if (!/^[a-z0-9]{1,16}$/.test(runId ?? "")) throw new Error("RUN_ID must match [a-z0-9]{1,16}");
  const token = await login();
  const products = await getJson(
    `${e.SUPABASE_URL}/rest/v1/products?select=id&sku=like.LG-*&is_deleted=eq.false`,
    { headers: { apikey: e.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` } },
  );
  if (products.length === 0) throw new Error("no LG-* products found; run the seed");
  const pid = products[0].id;
  const send = (requestId, n, quantity = 1) => post(token, body(requestId, tagFor(runId, n), pid, quantity));

  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  // A: the documented contract. Same requestId, same tag, one after the other.
  const A = [await send(a, 0), await send(a, 0)];
  // B: a retry racing the original. Same requestId, sent together.
  const B = await Promise.all([send(b, 1), send(b, 1)]);
  // C: key reuse with different content (new tag, quantity 2). Must not create a second sale.
  const C = [await send(c, 2, 1), await send(c, 3, 2)];

  console.log(JSON.stringify({
    run: runId,
    cases: {
      A_sequential: { tags: [tagFor(runId, 0)], requestId: a, responses: A },
      B_concurrent: { tags: [tagFor(runId, 1)], requestId: b, responses: B },
      C_conflicting: { tags: [tagFor(runId, 2), tagFor(runId, 3)], requestId: c, responses: C },
    },
  }, null, 2));
}

function verify(resultsFile, ledgerFile) {
  const { run, cases } = JSON.parse(readFileSync(resultsFile, "utf8"));
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
  if (!Array.isArray(ledger) || ledger.some((r) => !String(r.mpesa_ref).startsWith(`lg-${run}-`))) {
    throw new Error("ledger is not an array of rows for this run");
  }
  const rows = (n) => ledger.find((r) => r.mpesa_ref === tagFor(run, n))?.rows ?? 0;
  const { A_sequential: A, B_concurrent: B, C_conflicting: C } = cases;
  const acked = (c) => c.responses.filter((r) => r.ok);
  const sameSale = (c) => new Set(acked(c).map((r) => r.saleId)).size <= 1;
  const checks = [
    ["safety", "A: one ledger row for a replayed requestId", rows(0) === 1],
    ["safety", "A: replay never returns a different sale", sameSale(A)],
    ["safety", "B: one ledger row for concurrent duplicates", rows(1) === 1],
    ["safety", "B: concurrent duplicates never return different sales", sameSale(B)],
    ["safety", "C: reused requestId with new content created no second sale", rows(2) === 1 && rows(3) === 0],
    ["safety", "C: no different sale returned", sameSale(C)],
    ["contract", "A: replay acknowledged with the original sale", acked(A).length === 2],
    ["contract", "B: both concurrent duplicates acknowledged", acked(B).length === 2],
  ];
  for (const [kind, name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  [${kind}] ${name}`);
  const failed = checks.filter(([, , ok]) => !ok);
  console.log(`\none local observation (run ${run}); not a general idempotency claim`);
  console.log(`safety failures: ${failed.filter(([k]) => k === "safety").length}, contract gaps: ${failed.filter(([k]) => k === "contract").length}`);
  if (failed.length) process.exitCode = 1;
}

try {
  if (mode === "--run" && process.argv.length === 3) await runCases();
  else if (mode === "--verify" && process.argv.length === 5) verify(process.argv[3], process.argv[4]);
  else if (mode === "--replay-lost" && process.argv.length === 5) await replayLost(process.argv[3], process.argv[4]);
  else if (mode === "--verify-lost" && process.argv.length === 5) verifyLost(process.argv[3], process.argv[4]);
  else throw new Error("usage: --run | --verify <replay.json> <ledger.json> | --replay-lost <client.jsonl> <ledger.json> | --verify-lost <replay-lost.json> <ledger-after.json>");
} catch (error) {
  console.error(`INVALID: ${error.message}`);
  process.exitCode = 2;
}
// All request sockets are closed by the response handlers. Let stdout flush so
// redirected verifier output is not discarded by an immediate process.exit().
await new Promise(resolve => setImmediate(resolve));
process.exitCode ??= 0;
