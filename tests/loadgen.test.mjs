import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { parseClientLog } from '../measurements/scripts/client-log.mjs';

const execute = promisify(execFile);
const validBody = JSON.parse(readFileSync('docs/evidence/baseline/base2-client.jsonl', 'utf8').split('\n')[0]).body;
const errorBody = JSON.parse(readFileSync('measurements/results/sc01c2/client.jsonl', 'utf8').split('\n')[0]).body;

async function generate(t, responseBody, trickle = false) {
  let posts = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/auth/v1/token')) { req.resume(); res.end('{"access_token":"fixture-token"}'); }
    else if (req.url.startsWith('/rest/v1/products')) res.end('[{"id":"00000000-0000-4000-8000-000000000001"}]');
    else {
      posts++;
      assert.equal(req.headers.authorization, 'Bearer fixture-token');
      assert.equal(req.headers['sec-fetch-site'], 'same-origin');
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body).t.p.v[0].p;
      const requestId = data.v[data.k.indexOf('requestId')].s;
      assert.match(requestId, /^[0-9a-f-]{36}$/);
      if (trickle) {
        res.write(' ');
        const timer = setInterval(() => res.write(' '), 100);
        res.on('close', () => clearInterval(timer));
      } else res.end(responseBody);
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, SUPABASE_URL: url, TARGET_URL: url,
    SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key', LOAD_EMAIL: 'fixture@example.invalid',
    LOAD_PASSWORD: 'fixture-password', SALE_FN_ID: 'fixture-function',
    BRANCH_ID: '00000000-0000-4000-8000-000000000002', RUN_ID: 'test', RPS: '1', DURATION_S: '1' };
  delete env.NODE_TEST_CONTEXT;
  const result = await execute(process.execPath, ['load/loadgen.mjs'], { env, timeout: 45_000 });
  assert.equal(posts, 1, 'one request and no retries');
  return parseClientLog(result.stdout);
}
test('generator sends one tagged sale and logs a validated acknowledgement', async t => {
  const result = await generate(t, validBody);
  assert.equal(result.summary.sales_ok, 1); assert.equal(result.summary.failed, 0);
  assert.ok(result.rows[0].sent_ts);
});
test('generator logs an HTTP 200 application error as a failed sale', async t => {
  const result = await generate(t, errorBody);
  assert.equal(result.summary.http200, 1); assert.equal(result.summary.sales_ok, 0);
  assert.equal(result.summary.failed, 1); assert.equal(result.rows[0].ok, false);
});
test('absolute deadline stops a response that keeps the socket active', { timeout: 45_000 }, async t => {
  const result = await generate(t, '', true);
  assert.equal(result.summary.failed, 1); assert.equal(result.rows[0].status, 0);
  assert.equal(result.rows[0].err, 'timeout');
  assert.ok(result.rows[0].ms >= 29_000 && result.rows[0].ms < 35_000);
});
