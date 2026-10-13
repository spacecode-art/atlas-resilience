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

---

## Amendment 1 — Install verified (2026-10-13)

- **Pin:** Helm chart `chaos-mesh` 2.8.3 (release 2026-06-10). 2.8.3 patches critical and high CVEs in the container images.
- **Advisories:** JFrog "Chaotic Deputy" (CVE-2025-59358, -59359, -59360, -59361: an unauthenticated controller-manager debug server plus three OS command injections) is fixed in 2.7.3 per JFrog and the Go vulnerability database. 2.8.3 is later. Reviewed 2026-10-13.
- **Runtime:** containerd, socket `/run/containerd/containerd.sock` (kind default). Confirmed in `docs/evidence/chaos-install/c1-install.txt`.
- **Scope:** `controllerManager.enableFilterNamespace=true`. Only namespaces annotated `chaos-mesh.org/inject=enabled` are targetable (currently `tawira` only). Experiment CRDs therefore live in `tawira`.
- **Dashboard:** ClusterIP, `securityMode=true`, reached only through `kubectl port-forward --address 127.0.0.1`. Unauthenticated access shows an RBAC token prompt and nothing else (`c1-dashboard-auth.png`).
- **DNS chaos:** `dnsServer.create=true`, needed for SC-03.
- **Residual risk:** `chaos-daemon` runs privileged on every worker by design. Threat model entry required.
- **Config:** `chaos/install/values.yaml`.
- **Install note:** images from ghcr.io took 2 to 3 minutes each to pull on this host. Use `--timeout 10m`; a 5-minute `--atomic` install rolls back silently.
- **Verified:** smoke pod-kill inside `tawira` replaced one pod within 20s (`c2-smoke-pod-kill.txt`). An identical experiment aimed at `kube-system` was accepted but selected no targets and left CoreDNS untouched (`c3-filter-negative.txt`).
- **Operational rule:** the namespace filter fails silently (the object is created, the event log says `no pod is selected`). Every experiment run must confirm `Selected` and `AllInjected` are `True` before its result is trusted.