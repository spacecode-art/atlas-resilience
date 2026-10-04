# ADR-0002: Chaos Tooling — Chaos Mesh Plus Scripted Host Faults

## Status
Accepted

## Date
2026-10-03

---

## Context
The scenarios need several fault types: pod and node loss, network faults
between Tawira and its database, DNS failure, and expired certificates.
The Atlas Path plan names Chaos Mesh and LitmusChaos as candidates. Two
facts constrain the choice:

1. Experiments must be reviewable as code, committed under
   `chaos/experiments/`, consistent with the "Everything as Code" principle.
2. Chaos tools only reach what runs inside the cluster. Under ADR-0003,
   Supabase runs on the host, so some faults cannot be injected by any
   in-cluster tool.

## Options considered

| Option | Verdict |
|---|---|
| **Chaos Mesh** | Chosen for in-cluster faults. Experiments are Kubernetes CRDs (PodChaos, NetworkChaos, DNSChaos, Schedule, Workflow), so each one is a YAML file in the repo and a pull request away from review. |
| LitmusChaos | Viable and capable. Not chosen because, in my reading, its operating model (ChaosEngine plus the optional ChaosCenter portal) is heavier for a single-machine test bed. To be re-checked if Chaos Mesh proves unworkable on kind. |
| Chaos Toolkit | Lightweight and scriptable, but would still need a separate fault injector for the cluster. |
| Plain `kubectl` / `docker` scripts only | Covers node and container kills, but gives no declarative, reviewable network or DNS faults. Used only where nothing better reaches. |

## Decision
Use Chaos Mesh for every fault that targets something inside the cluster.
Use scripted `docker stop|pause|network` commands, committed under
`scripts/`, for faults on host-side components: the Supabase containers and
the kind node containers themselves.

Install details (exact version pin, container-runtime socket settings for
kind, whether the DNS chaos component is enabled) are verified at install
time and appended to this ADR as an amendment, rather than guessed here.

## Consequences
- **Chaos Mesh is itself an attack surface.** It holds powerful cluster
  permissions and has a dashboard. The install must be pinned to an exact
  version, namespace-scoped where supported, and the dashboard not exposed
  beyond localhost. Current security advisories are checked before pinning
  and recorded in the amendment. This repo's threat model covers it.
- Two injection mechanisms (CRDs and scripts) mean two places experiments
  can live. Rule: if Chaos Mesh can express it, it is a CRD; scripts exist
  only for what Chaos Mesh cannot reach, and each script's header states
  why.
- Every experiment, CRD or script, follows the same template in
  `docs/scenarios/`: hypothesis, steady state (measured from the Phase 3
  Golden Signals), blast radius, abort condition, result, and follow-up.
- SC-02 (database failure) is only partly expressible as a CRD, since the
  database is on the host. This split is documented in the scenario doc, not
  hidden.