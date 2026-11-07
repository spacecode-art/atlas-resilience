// Shared contract for generator output. Partial control logs are explicitly opt-in.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const acknowledged = row => row.status === 200 && row.ok === true && UUID.test(row.saleId ?? '');

export function parseClientLog(text, { complete = true } = {}) {
  const rows = [], tags = new Set();
  let summary, run;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); } catch { throw new Error(`invalid JSON at client line ${index + 1}`); }
    if (!value || typeof value !== 'object') throw new Error(`invalid client record at line ${index + 1}`);
    if (summary) throw new Error('summary must be the final client record');
    if (value.summary === true) { summary = value; continue; }
    if (typeof value.tag !== 'string') throw new Error(`unrecognized client record at line ${index + 1}`);
    const match = /^lg-([a-z0-9]{1,16})-(\d+)$/.exec(value.tag);
    if (!match || (run && run !== match[1])) throw new Error('invalid or mixed run tags');
    run = match[1];
    if (tags.has(value.tag)) throw new Error(`duplicate client tag ${value.tag}`);
    tags.add(value.tag);
    if (typeof value.ok !== 'boolean') throw new Error('sale outcomes were not validated; legacy HTTP-only data cannot establish sale RTO');
    if (typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts)) ||
        !Number.isFinite(value.ms) || value.ms < 0 || !Number.isInteger(value.status) ||
        !(value.status === 0 || (value.status >= 100 && value.status <= 599))) {
      throw new Error(`invalid timing or status for ${value.tag}`);
    }
    if (value.ok && !acknowledged(value)) throw new Error(`success without HTTP 200 and a sale UUID: ${value.tag}`);
    const sent = value.sent_ts === undefined ? Date.parse(value.ts) - value.ms : Date.parse(value.sent_ts);
    if (!Number.isFinite(sent) || sent > Date.parse(value.ts)) throw new Error(`invalid send time for ${value.tag}`);
    rows.push({ ...value, sent });
  }
  if (!rows.length) throw new Error('no request rows in client.jsonl; run is invalid, RTO cannot be measured');
  if (complete) {
    if (!summary) throw new Error('missing final summary; incomplete client log cannot establish RTO');
    const ok = rows.filter(acknowledged).length;
    const http200 = rows.filter(r => r.status === 200).length;
    const expected = { sent: rows.length, sales_ok: ok, failed: rows.length - ok, http200, non200: rows.length - http200 };
    if (summary.run !== run) throw new Error('summary run does not match client tags');
    for (const [key, count] of Object.entries(expected)) {
      if (summary[key] !== count) throw new Error(`summary ${key} does not match request rows`);
    }
    if (summary.rps !== undefined || summary.duration_s !== undefined) {
      if (!Number.isInteger(summary.rps) || summary.rps < 1 || !Number.isInteger(summary.duration_s) ||
          summary.duration_s < 1 || summary.rps * summary.duration_s !== rows.length) {
        throw new Error('summary does not contain the complete planned load');
      }
    }
    const sequence = new Set(rows.map(r => Number(r.tag.slice(r.tag.lastIndexOf('-') + 1))));
    if (sequence.size !== rows.length || [...sequence].some(i => !Number.isSafeInteger(i) || i < 0 || i >= rows.length)) {
      throw new Error('client request sequence has missing or repeated indices');
    }
  }
  return { rows, summary, run };
}
