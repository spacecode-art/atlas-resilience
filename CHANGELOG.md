# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- `docs(adr)`: ADR-0001 (local kind cluster as failure domain), ADR-0002
  (Chaos Mesh plus scripted host faults), ADR-0003 (Tawira on kind,
  Supabase on the host; status Proposed pending the environment spike)
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
  (`service.instance.id`); series count 1 to 3 across three replicas
  (ADR-0004)
- `fix(target)`: per-replica telemetry identity via the downward API
  (`OTEL_RESOURCE_ATTRIBUTES=service.instance.id=$(POD_NAME)`). Before:
  three pods produced one metric series. After: three series, labeled
  `exported_instance`. Evidence in `docs/evidence/replica-identity/`