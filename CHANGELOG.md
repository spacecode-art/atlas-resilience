# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- `docs(adr)`: ADR-0001 (local kind cluster as failure domain), ADR-0002
  (Chaos Mesh plus scripted host faults), ADR-0003 (Tawira on kind,
  Supabase on the host; accepted after the environment spike)
- `feat(cluster)`: 3-zone kind cluster config (one control plane, three
  workers labeled `topology.kubernetes.io/zone`)
- `feat(target)`: Tawira Deployment with zone topology spread. Added
  `matchLabelKeys: [pod-template-hash]` after spike S5 showed a 2/1/0
  placement skew during a rolling update
- `docs(evidence)`: spike S1 (cluster) and S5 (zone spread, before and
  after) results
- `ci`: secrets scan via `atlas-security`'s reusable workflow, Dependabot
  for GitHub Actions
- `docs(readme)`: README rewritten to the Atlas standard
- `chore`: removed empty scaffold placeholder files; each returns when
  it has content
- `docs(evidence)`: spike S2, S3, and S4 results; ADR-0003 accepted with
  results and findings recorded
- `docs`: README synced with the accepted spike; deployment guide gains
  the migration step
- `fix(target)`: per-replica telemetry identity via the downward API
  (`OTEL_RESOURCE_ATTRIBUTES=service.instance.id=$(POD_NAME)`). Before:
  three pods produced one metric series. After: three series, labeled
  `exported_instance`. Evidence in `docs/evidence/replica-identity/`

### 2026-11-02

- `feat(resilience)`: SC-01 `sc01c3` validated-sale results: one local run,
  60 s RTO, 5,480 matching sales, no missing acknowledgements or duplicates;
  invalid attempts retained with explicit status.
- `fix(load)`: require a sale UUID instead of HTTP 200 alone; send request UUIDs,
  extend the local trial in the seed, and reject empty/legacy measurement data.
- `fix(harness)`: startup/control gates, explicit failed recovery exits and
  invalid-recovery analysis guard; manual abort responsibility documented;
  nine fixture/stub regression checks added to a Node 22 CI job.
- `fix(target)`: non-root UID 100/GID 101, disabled privilege escalation and
  dropped capabilities after image identity verification.
- `docs(resilience)`: SC-01 verdicts, postmortem and runbook; ADR-0005 candidate
  overlay; F-01 detection remediation plan; README/status/date corrections.
- `docs(drills)`: SC-02 procedure, SC-05/SC-06 tabletops and Game Day plan/template
  prepared only; no new fault, rehearsal or Game Day recording claimed.
- `docs(security)`: optional disposable Cloudflare credentials, archive guidance
  and exclusion of workspace zip files.
- `feat(sc02)`: explicit read-only check, ledger-verified smoke and attended DB
  outage modes; local project/API/image/migration checks, control gate,
  bounded stop/restore and cleanup on command failure or cancellation.
  Fixture-tested only; no SC-02 live fault or result claimed.
- `fix(measurements)`: reject incomplete/inconsistent logs and sparse windows;
  exclude partial tails from establishing recovery, calculate DB-ready RTO on
  its own grid, and compare acknowledged UUIDs with an exported read-only ledger.
  Original SLO targets and SC-01's 60 s result are unchanged.
- `fix(load)`: absolute 30 s request deadline bounds connect and trickling
  responses; record send timestamps and planned load in the final summary.
- `docs(review)`: correct ADR-0001's duplicated target-workload content,
  consolidate SC-01 verdicts without strengthening the conclusions, and map
  remaining Phase 5 deliverables to the Atlas roadmap.
- `test(resilience)`: expand CI to 50 local fixture/stub regression checks;
  fail pod-CIDR preflight on Kubernetes API errors rather than reporting OK.
  Read-only live preflight correctly refuses the stale generator ConfigMap.
- `docs(scenarios)`: add a scoped SC-03 DNSChaos design and reviewed fixture;
  record SC-04's missing TLS boundary explicitly instead of presenting HTTP as
  certificate-expiry evidence.
