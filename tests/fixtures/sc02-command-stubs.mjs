// Loaded only by CLI tests with --import. Unknown commands fail; none reach Docker/Kubernetes.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
const profile = process.env.ATLAS_FIXTURE_CASE;
const record = value => appendFileSync(process.env.ATLAS_FIXTURE_CALLS, JSON.stringify(value) + '\n');
childProcess.execFile = (file, args, options, callback) => {
  record({ file, args });
  let value;
  try {
    const joined = args.join(' ');
    if (file === 'kubectl') {
      if (joined === 'config current-context') value = 'kind-atlas-resilience\n';
      else if (args.includes('config') && args.includes('view')) value = { clusters: [{ cluster: { server: 'https://127.0.0.1:6443' } }] };
      else if (args.includes('secret')) value = { data: { SUPABASE_URL: Buffer.from('http://172.21.0.1:54321').toString('base64'), TARGET_URL: Buffer.from('http://tawira:3000').toString('base64') } };
      else if (args.includes('deployment')) value = { spec: { replicas: 3, template: { spec: { containers: [{ image: 'tawira:chaos-local' }] } } }, status: { readyReplicas: 3 } };
      else if (args.includes('pods')) value = { items: Array.from({ length: 3 }, (_, i) => ({ metadata: {}, status: { phase: 'Running', conditions: [{ type: 'Ready', status: profile === 'unready-pod' && i === 0 ? 'False' : 'True' }], containerStatuses: [{ imageID: 'fixture-image-id' }] } })) };
      else if (args.includes('jobs')) value = { items: profile === 'active-job' ? [{ status: { active: 1 } }] : [] };
      else if (args.includes('configmap')) value = { data: { 'loadgen.mjs': profile === 'stale-config' ? 'stale' : readFileSync(new URL('../../load/loadgen.mjs', import.meta.url), 'utf8'), 'sale-result.mjs': readFileSync(new URL('../../load/sale-result.mjs', import.meta.url), 'utf8') } };
    } else if (file === 'docker') {
      if (args.includes('network')) value = [{ IPAM: { Config: [{ Gateway: '172.21.0.1' }] } }];
      else if (args.includes('inspect')) {
        if (args.at(-1).startsWith('supabase_kong_')) value = [{ Config: { Labels: { 'com.supabase.cli.project': 'fixture' } }, NetworkSettings: { Ports: { '8000/tcp': [{ HostPort: profile === 'wrong-api-port' ? '54322' : '54321' }] } } }];
        else value = [{ Id: 'fixture-db-id', State: { Running: true }, Image: 'fixture-db-image', Config: { Image: 'public.ecr.aws/supabase/postgres:fixture', Labels: { 'com.supabase.cli.project': profile === 'wrong-project' ? 'other' : 'fixture' } }, Mounts: [{ Destination: '/var/lib/postgresql/data' }] }];
      } else if (args.includes('pg_isready')) value = 'accepting connections\n';
      else if (args.includes('psql') && args.includes('-c')) value = joined.includes('schema_migrations') ? ['20260101000000'] : { products: 20, stock: 200000 };
    } else if (file === 'bash') value = 'OK\n';
    else if (file === 'git') value = 'fixture-source-commit\n';
    if (value === undefined) throw new Error(`unexpected stub command: ${file} ${joined}`);
    queueMicrotask(() => callback(null, typeof value === 'string' ? value : JSON.stringify(value), ''));
  } catch (error) { queueMicrotask(() => callback(error, '', '')); }
  return { stdin: { end() {} } };
};
syncBuiltinESMExports();
globalThis.fetch = async url => {
  record({ fetch: url });
  if (url !== 'http://127.0.0.1:9090/api/v1/alerts') throw new Error('unexpected fixture network request');
  return { ok: true, json: async () => ({ status: 'success', data: { alerts: [] } }) };
};
