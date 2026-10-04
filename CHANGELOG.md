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