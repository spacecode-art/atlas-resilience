# SC-02 preparation validation — 2026-11-02

This pass prepares a reproducible database experiment. It does not record a
live SC-02 smoke, DB outage, recovery result or Game Day. Existing `sc01c3`
client/ledger/event artifacts were read and preserved.

| Check | Observed result |
|---|---|
| `node --test --test-reporter=dot tests/*.test.mjs` on Node v22.23.4 | 50 passed, 0 failed (about 36 s). Local HTTP fixtures, command stubs, measurement fixtures and preserved SC-01 evidence. No Docker fault in tests. |
| Request deadline | A fixture kept sending response bytes; the generator still terminated the request at its absolute 30 s deadline. HTTP 200 application-error fixtures remain failed sales. |
| Control and measurement failure paths | Low volume, business failures, excessive latency, truncated/malformed/mixed data, inconsistent summaries, missing indices, sparse windows and misleading partial tails are rejected. |
| SC-02 preflight fixtures | Healthy read-only path passes; wrong project/API port, unready pod, active Job, stale code, absent smoke and reused evidence are refused before a fault. Existing evidence bytes remain unchanged. |
| Restoration fixtures | Stop/hold/start/readiness failures attempt restore; failed event storage cannot skip restoration; cleanup failure is surfaced. Interrupted recovery leaves the already restored DB running. These are function/command fixtures, not real Docker recovery evidence. |
| Preserved `sc01c3` reanalysis | Still 60 s fault-relative RTO; 5,480 acknowledged UUIDs match the saved ledger. Targets and raw artifacts unchanged. |
| Independent readiness anchor | Synthetic example: fault RTO 120 s, DB ready at +100 s, DB-ready RTO 30 s. Subtracting rounded RTOs would incorrectly give 20 s. |
| Real local `--check`, 18:02:07Z | Refused with `ConfigMap loadgen.mjs differs from local code; refresh both scripts`. DB/project/API/migration/inventory/replica/pod-CIDR checks preceding that guard passed. Resource/Prometheus checks after the guard were not reached. No Job, sale or fault was created. |
| Real read-only SQL export | New `export-ledger.sql`, invoked with `psql -X -qAt`, returned parseable JSON: 5,480 tags/rows for existing `sc01c3`, with UUID arrays. Ran in `BEGIN READ ONLY`; no data change. |
| `shellcheck` and `bash -n` | Passed for `scripts/sc01-zone-loss.sh` and `scripts/check-pod-cidrs.sh`. CIDR helper now propagates API errors instead of printing OK after failed process substitutions. |
| Real current pod-CIDR check | Passed: every running non-host-network pod IP is within its node's /24. |
| Documentation/YAML | 21 README/docs Markdown files checked for local links and closed fences; 6 workflow/target/load/cluster YAML files parsed. |
| Staged export secret scan | Pinned Gitleaks v8.24.3, network disabled, staged export mounted read-only: no leaks found. No `.env` files or workspace archives in the export. |
| Whitespace check | `git diff --check` passed; original raw output kept verbatim under existing attributes. |

The live environment still has the old generator ConfigMap. Refresh both
scripts and pass a new 150-sale smoke before scheduling `--run`. The runbook
records the commands, monitoring, recovery limits and evidence required for
H1–H6. Actual image deployment, a full live fault/restoration, app restart
behavior, alert MTTD and DB-ready RTO remain unverified for SC-02.

ADR-0001 was corrected from duplicated workload text with the correction date
visible. SC-01 verdicts were consolidated while preserving the user's cautious
“not refuted” interpretation and narrowing unisolated scheduling claims. The
roadmap checklist tracks missing DNS/certificate designs and the recorded
Game Day separately from optional SC-07/AWS work.
