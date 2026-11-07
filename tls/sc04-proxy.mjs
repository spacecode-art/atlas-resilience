// Disposable HTTPS termination for SC-04. It is intentionally a small Node
// proxy so the test does not depend on an unpinned ingress image or a second
// application. The process stays alive while SIGHUP replaces its TLS context.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const env = process.env;
const KEY = env.TLS_KEY_FILE ?? '/tls/tls.key';
const CERT = env.TLS_CERT_FILE ?? '/tls/tls.crt';
const UPSTREAM = new URL(env.UPSTREAM_URL ?? 'http://tawira:3000');
const PORT = Number(env.PORT ?? 8443);

if (UPSTREAM.protocol !== 'http:' || !Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('invalid proxy configuration');
}

const readTls = () => ({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) });
const server = https.createServer(readTls(), (client, response) => {
  const request = http.request({
    hostname: UPSTREAM.hostname,
    port: UPSTREAM.port || 80,
    path: client.url,
    method: client.method,
    headers: { ...client.headers, host: UPSTREAM.host, connection: 'close' },
  }, upstream => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  request.on('error', error => {
    console.error(`upstream error: ${error.code ?? error.message}`);
    if (!response.headersSent) response.writeHead(502);
    response.end('upstream unavailable\n');
  });
  client.pipe(request);
});

const loadCertificate = (reason) => {
  server.setSecureContext(readTls());
  console.log(JSON.stringify({ event: 'tls_context_loaded', reason, pid: process.pid, at: new Date().toISOString() }));
};
process.on('SIGHUP', () => {
  try { loadCertificate('SIGHUP'); }
  catch (error) { console.error(`TLS reload failed: ${error.message}`); process.exitCode = 1; }
});
server.on('tlsClientError', error => console.error(`tls client error: ${error.code ?? error.message}`));
server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'proxy_ready', port: PORT, upstream: UPSTREAM.toString(), pid: process.pid }));
});
