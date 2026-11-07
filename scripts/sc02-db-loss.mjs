#!/usr/bin/env node
// SC-02 targets a host-side local Supabase DB, outside Chaos Mesh's failure domain.
// Explicit --check/--smoke/--run modes. No container/volume removal or application restart.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseClientLog, acknowledged } from '../measurements/scripts/client-log.mjs';
import { databaseOutage } from './lib/sc02-lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const mode = process.argv[2], runId = process.env.RUN_ID;
const db = process.env.DB, project = process.env.LOCAL_PROJECT;
const context = 'kind-atlas-resilience', ns = 'tawira', node = 'atlas-resilience-worker2';
const PRE = 120, HOLD = 480, POST = 600, RPS = 5;
const duration = mode === '--smoke' ? 30 : PRE + HOLD + POST + 150;
const jobName = `loadgen-${runId}`;
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort(new Error(`operator ${signal}`)));
let out, jobCreated = false;
const redact = text => [db, project].filter(Boolean).reduce((s, value) => s.replaceAll(value, '<local-test>'), String(text));

function command(file, args, { input, timeout = 20_000, cleanup = false } = {}) {
  return new Promise((done, reject) => {
    const child = execFile(file, args, {
      timeout, maxBuffer: 64 * 1024 * 1024,
      ...(cleanup ? {} : { signal: abort.signal }),
    }, (error, stdout, stderr) => error ? reject(new Error(redact(`${file}: ${error.message}`))) : done(stdout));
    child.stdin?.end(input ?? '');
  });
}
const docker = (args, options) => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args], options);
const kube = (args, options) => command('kubectl', ['--context', context, '--request-timeout=10s', ...args], options);
const sql = (query, cleanup = false) => docker(['exec', db, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query], { cleanup });
const log = message => {
  const line = `${new Date().toISOString()} ${redact(message)}\n`;
  process.stdout.write(line);
  // A failed event write must throw inside the fault's restoration boundary.
  if (out) appendFileSync(join(out, 'events.log'), line);
};
async function artifact(name, value) {
  await writeFile(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
async function inspect(name) { return JSON.parse(await docker(['inspect', name]))[0]; }
async function ready(cleanup = false) {
  const end = Date.now() + 300_000;
  while (Date.now() < end) {
    try { await docker(['exec', db, 'pg_isready', '-U', 'postgres'], { timeout: 5000, cleanup }); return; }
    catch { await delay(2000, undefined, cleanup ? {} : { signal: abort.signal }); }
  }
  throw new Error('local DB readiness timeout after 300s');
}
async function start() {
  // Restoration must remain usable after cancellation of the measurement.
  await docker(['start', db], { timeout: 60_000, cleanup: true });
}
async function captureClient(name = 'live-client.jsonl', cleanup = false) {
  const text = await kube(['-n', ns, 'logs', `job/${jobName}`], { cleanup });
  await artifact(name, text);
  return text;
}
async function ledger(name = 'ledger.json') {
  const text = await docker(['exec', '-i', db, 'psql', '-X', '-qAt', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-v', `run_id=${runId}`], {
    input: await readFile('measurements/scripts/export-ledger.sql', 'utf8'),
  });
  JSON.parse(text); // Do not save SQL diagnostic text as a valid ledger.
  await artifact(name, text);
}
async function resources() {
  const memory = await readFile('/proc/meminfo', 'utf8');
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]) * 1024;
  const disk = await statfs(root);
  const freeDisk = disk.bavail * disk.bsize;
  if (!Number.isFinite(available) || available < 1024 ** 3 || freeDisk < 2 * 1024 ** 3) {
    throw new Error('host resource floor violated: require 1 GiB MemAvailable and 2 GiB free disk');
  }
  return { memory_available_bytes: available, disk_available_bytes: freeDisk };
}
async function alerts() {
  const response = await fetch('http://127.0.0.1:9090/api/v1/alerts', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
  if (!response.ok) throw new Error(`Prometheus observation failed: ${response.status}`);
  const value = await response.json();
  if (value.status !== 'success') throw new Error('Prometheus returned an unsuccessful observation');
  return value.data.alerts;
}
async function sample() {
  const pods = JSON.parse(await kube(['-n', ns, 'get', 'pods', '-l', 'app=tawira', '-o', 'json']));
  const running = (await docker(['inspect', '-f', '{{.State.Running}}', db])).trim() === 'true';
  const state = {
    ts: new Date().toISOString(), db_running: running, ...await resources(), alerts: await alerts(),
    pods: pods.items.map(p => ({ name: p.metadata.name, node: p.spec.nodeName,
      phase: p.status.phase, ready: p.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'),
      restarts: (p.status.containerStatuses ?? []).reduce((n, c) => n + c.restartCount, 0) })),
  };
  await writeFile(join(out, 'timeline.jsonl'), JSON.stringify(state) + '\n', { flag: 'a' });
}
async function phase(label, seconds, verifyLedger = false) {
  log(`PHASE ${label} (${seconds}s)`);
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await sample();
    const text = await captureClient();
    if (verifyLedger) {
      await ledger('monitor-ledger.json');
      const entries = JSON.parse(await readFile(join(out, 'monitor-ledger.json'), 'utf8'));
      if (entries.some(r => r.rows > 1)) throw new Error('duplicate tagged sale; manual investigation required');
      const completeLines = text.slice(0, text.lastIndexOf('\n') + 1);
      const { rows } = parseClientLog(completeLines, { complete: false });
      const byTag = new Map(entries.map(r => [r.mpesa_ref, r]));
      if (rows.filter(acknowledged).some(r => !byTag.get(r.tag)?.sale_ids.includes(r.saleId))) {
        throw new Error('acknowledged sale missing or UUID mismatched in local ledger');
      }
    }
    await delay(Math.max(1, Math.min(10_000, end - Date.now())), undefined, { signal: abort.signal });
  }
}
async function waitJob() {
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    const job = JSON.parse(await kube(['-n', ns, 'get', 'job', jobName, '-o', 'json']));
    if (job.status.succeeded === 1) return;
    if (job.status.failed) throw new Error('load Job failed');
    await delay(2000, undefined, { signal: abort.signal });
  }
  throw new Error('load Job did not complete in the observation margin');
}

try {
  if (!['--check', '--smoke', '--run'].includes(mode) || process.argv.length !== 3 ||
      !/^[a-z0-9]{1,16}$/.test(runId ?? '') || !/^supabase_db_[A-Za-z0-9_-]+$/.test(db ?? '') || !project) {
    throw new Error('usage: DB=<local-container> LOCAL_PROJECT=<expected-label> RUN_ID=<new-id> node scripts/sc02-db-loss.mjs --check|--smoke|--run');
  }
  if ((await command('kubectl', ['config', 'current-context'])).trim() !== context) throw new Error('current kubectl context is not the local resilience cluster');
  const config = JSON.parse(await kube(['config', 'view', '--minify', '-o', 'json']));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.clusters[0].cluster.server).hostname)) throw new Error('kind API endpoint is not loopback');
  const container = await inspect(db);
  if (!container.State.Running || container.Config.Labels?.['com.supabase.cli.project'] !== project ||
      !/^(public\.ecr\.aws\/supabase\/postgres|supabase\/postgres)(:|@)/.test(container.Config.Image) ||
      !container.Mounts.some(m => m.Destination.startsWith('/var/lib/postgresql/'))) throw new Error('selected DB does not match the expected local project, image, running state and persistent mount');
  await ready();
  const migrations = JSON.parse(await sql("select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations;"));
  if (!Array.isArray(migrations)) throw new Error('local migration history was not readable');
  const seed = JSON.parse(await sql("select json_build_object('products',count(*),'stock',coalesce(sum(stock),0)) from public.products where shop_id='d841607b-9f0e-447b-998b-efec2e6d89e0'::uuid and sku like 'LG-%' and not is_deleted;"));
  if (seed.products !== 20 || Number(seed.stock) < RPS * duration) throw new Error('seeded test inventory missing or insufficient; run the local seed');
  const secret = JSON.parse(await kube(['-n', ns, 'get', 'secret', 'loadgen-env', '-o', 'json']));
  const sb = new URL(Buffer.from(secret.data.SUPABASE_URL ?? '', 'base64').toString());
  const target = new URL(Buffer.from(secret.data.TARGET_URL ?? '', 'base64').toString());
  const network = JSON.parse(await docker(['network', 'inspect', 'kind']))[0];
  if (sb.protocol !== 'http:' || !network.IPAM.Config.some(c => c.Gateway === sb.hostname) ||
      target.protocol !== 'http:' || !['tawira', 'tawira.tawira.svc.cluster.local'].includes(target.hostname) || target.port !== '3000') throw new Error('load generator is not configured for the local bridge and Tawira Service');
  const kong = await inspect(db.replace(/^supabase_db_/, 'supabase_kong_'));
  if (kong.Config.Labels?.['com.supabase.cli.project'] !== project ||
      !kong.NetworkSettings.Ports?.['8000/tcp']?.some(p => p.HostPort === sb.port)) throw new Error('local Supabase API port does not belong to the selected DB project');
  const deployment = JSON.parse(await kube(['-n', ns, 'get', 'deployment', 'tawira', '-o', 'json']));
  if (deployment.spec.replicas !== 3 || deployment.status.readyReplicas !== 3) throw new Error('Tawira is not 3/3 Ready');
  const appPods = JSON.parse(await kube(['-n', ns, 'get', 'pods', '-l', 'app=tawira', '-o', 'json']));
  if (appPods.items.length !== 3 || appPods.items.some(p => p.metadata.deletionTimestamp ||
      p.status.phase !== 'Running' || !p.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))) {
    throw new Error('require exactly three running, Ready application pods with no pending termination');
  }
  const imageIds = [...new Set(appPods.items.flatMap(p => (p.status.containerStatuses ?? []).map(c => c.imageID)))].sort();
  if (imageIds.length !== 1 || !imageIds[0]) throw new Error('application replicas do not share one recorded image ID');
  const jobs = JSON.parse(await kube(['-n', ns, 'get', 'jobs', '-o', 'json']));
  if (jobs.items.some(j => j.status.active)) throw new Error('another Job is active; use a dedicated test session');
  await command('bash', ['scripts/check-pod-cidrs.sh']);
  const cm = JSON.parse(await kube(['-n', ns, 'get', 'configmap', 'loadgen-script', '-o', 'json']));
  const hashes = {};
  for (const name of ['loadgen.mjs', 'sale-result.mjs']) {
    const text = await readFile(`load/${name}`, 'utf8');
    if (cm.data[name] !== text) throw new Error(`ConfigMap ${name} differs from local code; refresh both scripts`);
    hashes[name] = createHash('sha256').update(text).digest('hex');
  }
  await resources(); await alerts();
  const sourceHashes = {};
  for (const file of ['scripts/sc02-db-loss.mjs', 'scripts/lib/sc02-lifecycle.mjs',
    'measurements/scripts/client-log.mjs', 'measurements/scripts/control.mjs',
    'measurements/scripts/reconcile.mjs', 'measurements/scripts/windows.mjs',
    'measurements/scripts/export-ledger.sql', 'scripts/check-pod-cidrs.sh', 'load/job.yaml']) {
    sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  const metadata = { scenario: 'SC-02', mode: mode.slice(2), run: runId, rps: RPS, duration_s: duration,
    pre_s: PRE, hold_s: HOLD, post_s: POST, db_container_id: container.Id,
    db_image: container.Image, db_migrations: migrations, local_project_verified: true, generator_sha256: hashes, source_sha256: sourceHashes,
    app_images: deployment.spec.template.spec.containers.map(c => c.image), app_image_ids: imageIds, context, node,
    source_commit: (await command('git', ['rev-parse', 'HEAD'])).trim(), started_at: new Date().toISOString() };
  if (mode === '--check') { console.log(JSON.stringify({ preflight: 'passed', ...metadata }, null, 2)); }
  else {
    if (mode === '--run') {
      const smoke = resolve(process.env.SMOKE_DIR ?? '');
      const prior = JSON.parse(await readFile(join(smoke, 'run.json'), 'utf8'));
      const { rows, summary } = parseClientLog(await readFile(join(smoke, 'client.jsonl'), 'utf8'));
      const age = Date.now() - Math.max(...rows.map(r => Date.parse(r.ts)));
      if (prior.mode !== 'smoke' || prior.run !== summary.run ||
          JSON.stringify(prior.app_image_ids) !== JSON.stringify(imageIds) || prior.db_container_id !== metadata.db_container_id ||
          JSON.stringify(prior.db_migrations) !== JSON.stringify(migrations) ||
          JSON.stringify(prior.generator_sha256) !== JSON.stringify(hashes) ||
          JSON.stringify(prior.source_sha256) !== JSON.stringify(sourceHashes) ||
          summary.sent !== 150 || summary.sales_ok !== 150 ||
          age < -2000 || age > 3_600_000) throw new Error('require a ledger-verified smoke from the last hour on this DB and generator');
      await command('node', ['measurements/scripts/reconcile.mjs', join(smoke, 'client.jsonl'), join(smoke, 'ledger.json')]);
    }
    const destination = resolve('measurements/results', runId);
    await mkdir(destination);
    out = destination; // Existing evidence always refuses a rerun.
    await artifact('run.json', metadata);
    const job = JSON.parse(await kube(['create', '--dry-run=client', '-f', 'load/job.yaml', '-o', 'json']));
    job.metadata.name = jobName;
    job.spec.template.spec.nodeSelector = { 'kubernetes.io/hostname': node };
    job.spec.template.spec.containers[0].env = [{ name: 'RPS', value: String(RPS) }, { name: 'DURATION_S', value: String(duration) }, { name: 'RUN_ID', value: runId }];
    await artifact('job.json', job);
    await kube(['-n', ns, 'create', '-f', '-'], { input: JSON.stringify(job) }); jobCreated = true;
    const bootEnd = Date.now() + 120_000;
    let pod;
    while (Date.now() < bootEnd) {
      const pods = JSON.parse(await kube(['-n', ns, 'get', 'pods', '-l', `job-name=${jobName}`, '-o', 'json']));
      pod = pods.items[0];
      if (pod?.status.phase === 'Running') break;
      if (['Failed', 'Succeeded'].includes(pod?.status.phase)) throw new Error('load generator exited during startup');
      await delay(1000, undefined, { signal: abort.signal });
    }
    const loadNode = JSON.parse(await kube(['get', 'node', node, '-o', 'json']));
    if (!pod || pod.status.phase !== 'Running' || !loadNode.spec.podCIDR.endsWith('/24') ||
        pod.status.podIP.split('.').slice(0, 3).join('.') !== loadNode.spec.podCIDR.split('.').slice(0, 3).join('.')) throw new Error('load pod startup or per-node podCIDR check failed');
    log(`LOAD started run=${runId} rps=${RPS} duration=${duration}s`);
    if (mode === '--run') {
      await delay(15_000, undefined, { signal: abort.signal });
      const jobState = JSON.parse(await kube(['-n', ns, 'get', 'pods', '-l', `job-name=${jobName}`, '-o', 'json']));
      if (jobState.items[0]?.status.phase !== 'Running') throw new Error('load generator not running 15 s after start');
      await phase('control', PRE - 15, true);
      await captureClient('control.jsonl');
      const result = await command('node', ['measurements/scripts/control.mjs', join(out, 'control.jsonl'), String(RPS), String(PRE)]);
      await artifact('control-result.json', result); log('CONTROL OK: validated sales, volume and latency targets met');
      const beforeFault = await inspect(db);
      if (beforeFault.Id !== container.Id || !beforeFault.State.Running) throw new Error('DB identity or running state changed after preflight');
      await databaseOutage({ log,
        stop: () => docker(['stop', '--time', '30', db], { timeout: 45_000 }),
        start, ready: () => ready(true), hold: () => phase('db-unavailable', HOLD),
        observe: () => phase('recovery', POST, true),
      });
    }
    await waitJob(); await captureClient('client.jsonl'); await ledger();
    const { rows, summary } = parseClientLog(await readFile(join(out, 'client.jsonl'), 'utf8'));
    if (summary.sent !== RPS * duration) throw new Error('request count differs from planned load');
    await artifact('reconcile.json', await command('node', ['measurements/scripts/reconcile.mjs', join(out, 'client.jsonl'), join(out, 'ledger.json')]));
    if (mode === '--smoke' && summary.sales_ok !== 150) throw new Error('smoke requires 150 acknowledged sales');
    if (mode === '--run') {
      const events = await readFile(join(out, 'events.log'), 'utf8');
      const dbReady = Date.parse(events.split('\n').find(l => / DB_READY$/.test(l)).split(' ')[0]);
      if (Math.max(...rows.map(r => r.sent)) < dbReady + POST * 1000 - 1000) throw new Error('load ended before the required recovery observation');
      await artifact('windows.txt', await command('node', ['measurements/scripts/windows.mjs', out]));
    }
    await sample(); log('DONE measurement and ledger captured; verify verdicts and alert history before reporting results');
  }
} catch (error) {
  process.exitCode = abort.signal.aborted ? 130 : 1;
  try { log(`ABORT ${error.message}`); }
  catch { console.error(redact(`ABORT ${error.message}; events.log could not be written`)); }
} finally {
  if (jobCreated && process.exitCode) {
    try { await captureClient('client.jsonl', true); } catch { /* Primary failure remains in events. */ }
    try { await kube(['-n', ns, 'delete', 'job', jobName, '--wait=false'], { cleanup: true }); }
    catch (error) { console.error(redact(`CLEANUP FAILED ${error.message}; stop the owned load Job manually`)); }
  }
}
