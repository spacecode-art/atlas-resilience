import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function requests(n, success = () => true) {
  return Array.from({ length: n }, (_, i) => {
    const ok = success(i);
    return { tag: `lg-test-${String(i).padStart(5, '0')}`, ts: new Date(Date.UTC(2026, 10, 2) + i * 1000 + 100).toISOString(),
      ms: 100, status: ok ? 200 : 0, ok, ...(ok ? { saleId: uuid(i + 1) } : { err: 'timeout' }) };
  });
}
export function clientText(rows) {
  const ok = rows.filter(r => r.ok && r.status === 200).length;
  const http200 = rows.filter(r => r.status === 200).length;
  return [...rows, { summary: true, run: 'test', sent: rows.length, sales_ok: ok, failed: rows.length - ok, http200, non200: rows.length - http200 }].map(JSON.stringify).join('\n') + '\n';
}
export function cli(path, args = [], extra = {}) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [path, ...args], { encoding: 'utf8', env, ...extra });
}
export function saveRun(dir, rows, extraEvents = '') {
  writeFileSync(`${dir}/client.jsonl`, clientText(rows));
  writeFileSync(`${dir}/events.log`, `2026-11-02T00:00:00Z FAULT docker stop local-test-db\n${extraEvents}`);
}
