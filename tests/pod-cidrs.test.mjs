import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const script = readFileSync(new URL('../scripts/check-pod-cidrs.sh', import.meta.url), 'utf8');
for (const [name, nodeStatus, podStatus, podIP, expected] of [
  ['matching CIDR', 0, 0, '10.244.2.4', 0],
  ['node API failure', 1, 0, '10.244.2.4', 1],
  ['pod API failure', 0, 1, '10.244.2.4', 1],
  ['mismatched CIDR', 0, 0, '10.244.1.4', 1],
]) {
  test(`pod network preflight: ${name}`, () => {
    const result = spawnSync('bash', ['-euc', `
      kubectl() {
        case "$*" in
          'config current-context') echo kind-atlas-resilience ;;
          *'get nodes'*) echo 'worker2 10.244.2.0/24'; return ${nodeStatus} ;;
          *'get pods'*) echo 'tawira|app|worker2|${podIP}|false'; return ${podStatus} ;;
          *) return 99 ;;
        esac
      }
      ${script}
    `], { encoding: 'utf8', env: { ...process.env, CONTEXT: 'kind-atlas-resilience' } });
    assert.ifError(result.error); assert.equal(result.status, expected, result.stderr);
    if (expected) assert.doesNotMatch(result.stdout, /^OK:/m);
    else assert.match(result.stdout, /^OK:/m);
  });
}
