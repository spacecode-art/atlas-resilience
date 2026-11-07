import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { once } from 'node:events';

const root = new URL('../', import.meta.url);
const proxyFile = new URL('../tls/sc04-proxy.mjs', import.meta.url);

function openssl(args, cwd) {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

async function request(port, ca) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: '127.0.0.1', port, path: '/', ca, servername: 'sc04-tls-proxy' }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
  });
}

test('SC-04 proxy reloads a new leaf without changing its process', { timeout: 30_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-sc04-tls-'));
  const upstream = http.createServer((_req, res) => res.end('ok'));
  await once(upstream.listen(0, '127.0.0.1'), 'listening');
  const port = upstream.address().port + 1;
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
      '-subj', '/CN=Atlas SC04 Test CA', '-keyout', 'ca.key', '-out', 'ca.crt'], dir);
    for (const [name, cn] of [['one', 'sc04-one'], ['two', 'sc04-two']]) {
      openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', `/CN=${cn}`,
        '-addext', 'subjectAltName=DNS:sc04-tls-proxy', '-keyout', `${name}.key`, '-out', `${name}.csr`], dir);
      writeFileSync(join(dir, `${name}.ext`), '[v3]\nsubjectAltName=DNS:sc04-tls-proxy\n');
      const serial = name === 'one' ? ['-CAcreateserial'] : ['-CAserial', 'ca.srl'];
      openssl(['x509', '-req', '-sha256', '-days', '20', '-in', `${name}.csr`, '-CA', 'ca.crt',
        '-CAkey', 'ca.key', ...serial, '-extfile', `${name}.ext`, '-extensions', 'v3', '-out', `${name}.crt`], dir);
    }
  } catch (error) {
    upstream.close(); rmSync(dir, { recursive: true }); throw error;
  }
  const proxy = spawn(process.execPath, [proxyFile.pathname], { cwd: root.pathname, env: {
    ...process.env, PORT: String(port), UPSTREAM_URL: `http://127.0.0.1:${upstream.address().port}`,
    TLS_KEY_FILE: join(dir, 'one.key'), TLS_CERT_FILE: join(dir, 'one.crt'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { proxy.kill('SIGTERM'); upstream.close(); rmSync(dir, { recursive: true }); });
  let output = ''; proxy.stdout.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`proxy did not start: ${output}`)), 5000);
    const poll = () => output.includes('proxy_ready') ? (clearTimeout(timer), resolve()) : setTimeout(poll, 20);
    poll();
  });
  const pid = proxy.pid;
  assert.equal(await request(port, readFileSync(join(dir, 'ca.crt'))), 200);
  writeFileSync(join(dir, 'one.key'), readFileSync(join(dir, 'two.key')));
  writeFileSync(join(dir, 'one.crt'), readFileSync(join(dir, 'two.crt')));
  proxy.kill('SIGHUP');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await request(port, readFileSync(join(dir, 'ca.crt'))), 200);
  assert.equal(proxy.pid, pid);
  assert.match(output, /"reason":"SIGHUP"/);
});
