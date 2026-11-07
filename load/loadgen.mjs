// Open-loop sale generator. Posts to Tawira's recordSale server function.
// Wire format: TanStack Start (seroval) as captured from one real request.
// It belongs to the installed framework version and may change on upgrade.
// Every request carries a unique tag in mpesaRef (method is cash) so that
// sales can be counted in the database afterward: lost, duplicate, ambiguous.
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { saleResult } from "./sale-result.mjs";

const e = process.env;
const SUPABASE_URL = e.SUPABASE_URL;
const PUB = e.SUPABASE_PUBLISHABLE_KEY;
const TARGET = e.TARGET_URL;
const FN_ID = e.SALE_FN_ID;
const BRANCH_ID = e.BRANCH_ID;
const RPS = Number(e.RPS ?? 1);
const DURATION_S = Number(e.DURATION_S ?? 5);
const RUN_ID = e.RUN_ID ?? Date.now().toString(36);

if (!Number.isInteger(RPS) || RPS < 1 || !Number.isInteger(DURATION_S) || DURATION_S < 1 ||
    !/^[a-z0-9]{1,16}$/.test(RUN_ID)) throw new Error("invalid RPS, DURATION_S or RUN_ID");
const targetUrl = new URL(TARGET);
if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error("local load generator requires an http(s) TARGET_URL");

async function getJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const auth = await getJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: PUB, "content-type": "application/json" },
  body: JSON.stringify({ email: e.LOAD_EMAIL, password: e.LOAD_PASSWORD }),
});
const token = auth.access_token;

const products = await getJson(
  `${SUPABASE_URL}/rest/v1/products?select=id&sku=like.LG-*&is_deleted=eq.false`,
  { headers: { apikey: PUB, authorization: `Bearer ${token}` } },
);
if (products.length === 0) throw new Error("no LG-* products found; run the seed");

const str = (s) => ({ t: 1, s });
const undef = { t: 2, s: 1 };
const item = (productId, i) => ({
  t: 10, i, o: 0,
  p: {
    k: ["product_id", "quantity", "selling_unit_id", "override_price"],
    v: [str(productId), { t: 0, s: 1 }, undef, undef],
  },
});
const body = (tag, productId) =>
  JSON.stringify({
    t: {
      t: 10, i: 0, o: 0,
      p: {
        k: ["data"],
        v: [{
          t: 10, i: 1, o: 0,
          p: {
            k: ["requestId", "branchId", "method", "mpesaRef", "customerName", "customerPhone", "items"],
            v: [str(randomUUID()), str(BRANCH_ID), str("cash"), str(tag), undef, undef,
                { t: 9, i: 2, a: [item(productId, 3)], o: 0 }],
          },
        }],
      },
    },
    f: 63,
    m: [],
  });

function post(payload) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sentAt = new Date().toISOString();
    let deadline;
    const finish = result => {
      clearTimeout(deadline);
      resolve({ ...result, sent_ts: sentAt, ms: Math.round(performance.now() - t0) });
    };
    const u = new URL(`${TARGET}/_serverFn/${FN_ID}`);
    const request = u.protocol === 'https:' ? https.request : http.request;
    const req = request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        agent: false, timeout: 30000,
        headers: {
          "content-type": "application/json",
          // TanStack Start's CSRF middleware rejects POSTs carrying no Origin,
          // Sec-Fetch-Site or Referer. Browsers send these on same-origin
          // POSTs; a Node client must send them explicitly.
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
        res.on("end", () => finish({
          status: res.statusCode, ms: Math.round(performance.now() - t0),
          ...saleResult(b), body: b.slice(0, 3000),
        }));
        res.on("aborted", () => finish({ status: 0, ok: false, ms: Math.round(performance.now() - t0), err: "response aborted" }));
        res.on("error", (err) => finish({ status: 0, ok: false, ms: Math.round(performance.now() - t0), err: err.message }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => finish({ status: 0, ok: false, ms: Math.round(performance.now() - t0), err: err.message }));
    // An absolute deadline also bounds DNS/connect time; socket idle timeout alone does not.
    deadline = setTimeout(() => req.destroy(new Error("timeout")), 30_000);
    req.end(payload);
  });
}

const total = RPS * DURATION_S;
const results = [];
const inflight = new Set();
let n = 0;

await new Promise((done) => {
  const timer = setInterval(() => {
    if (n >= total) { clearInterval(timer); done(); return; }
    const idx = n++;
    const tag = `lg-${RUN_ID}-${String(idx).padStart(5, "0")}`;
    const pid = products[Math.floor(Math.random() * products.length)].id;
    const p = post(body(tag, pid)).then((r) => {
      results.push(r);
      r.ok = r.status === 200 && r.ok === true;
      const keepBody = idx === 0 || !r.ok;
      console.log(JSON.stringify({ tag, ts: new Date().toISOString(), sent_ts: r.sent_ts, status: r.status, ok: r.ok, saleId: r.saleId, ms: r.ms, err: r.err, body: keepBody ? r.body : undefined }));
    });
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  }, 1000 / RPS);
});
await Promise.all(inflight);

const ok = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const pct = (q) => (ok.length ? ok[Math.min(ok.length - 1, Math.floor(q * ok.length))] : null);
console.log(JSON.stringify({
  summary: true, run: RUN_ID, rps: RPS, duration_s: DURATION_S, sent: results.length,
  http200: results.filter((r) => r.status === 200).length,
  non200: results.filter((r) => r.status !== 200).length,
  sales_ok: ok.length, failed: results.length - ok.length,
  p50_ms: pct(0.5), p95_ms: pct(0.95), p99_ms: pct(0.99),
}));
process.exit(0); // pending DNS lookups must not keep the Job alive
