# Atlas Resilience

> Resilience engineering for the Atlas platform: failure injection, Game
> Days, and measured recovery against a real application, run locally at
> zero cost.

## Problem Statement

Systems are usually shown running and rarely shown failing. "Highly
available" is an assertion until someone kills a zone, partitions the
database, or expires a certificate and measures what happens. Atlas
Resilience does that deliberately. Scenarios declare hypotheses and targets
before injection. Completed runs
preserve client outcomes, database reconciliation and Phase 3 telemetry,
including failed hypotheses. The status table distinguishes measured runs
from designs that have not been exercised.

## A note on anonymization

The workload under test is Tawira, a production SaaS application I run,
not a sample app. Service names and other identifying details are
genericized (`atlas-demo-*`) because Tawira is private. Behavior,
timings, and defects reported here are real and unmodified. Everything
runs against a local Supabase instance, never against production data.
See [ADR-0003](docs/adr/ADR-0003-target-workload.md) for why a real
application was chosen, consistent with the same decision in
[`atlas-security`](https://github.com/spacecode-art/atlas-security) and
[`atlas-observability`](https://github.com/spacecode-art/atlas-observability).

## Overview

Atlas Resilience is Phase 5 of the Atlas platform. It runs Tawira on a
three-zone kind cluster, injects failures with Chaos Mesh and scripted
host-side faults, watches the results through the Phase 3 Golden Signals
stack, and produces runbooks, measured RTO/RPO, and blameless
postmortems. Defects found along the way are fixed with before/after
evidence.

---

## Objectives

- Six failure scenarios (SC-01 to SC-06), with design and evidence. SC-01 to
  SC-04 have local fault exercises; SC-05 and SC-06 are synthetic tabletop
  rehearsals.
- Operator runbooks for SC-01 and SC-02
- A real application on a three-zone local cluster, with replicas
  spread across zones
- Every experiment states its hypothesis, steady state, blast radius,
  and abort condition before it runs
- Detection time measured through the Phase 3 Golden Signals stack, not
  assumed
- Defects found by experiments fixed in the application with
  before/after evidence
- Every non-trivial decision recorded as an ADR, same discipline as the
  other Atlas repositories

---

## Phase 5 progress

SC-01 has two unchanged-policy runs and one separate ADR-0005 comparison. SC-02
has three valid database outage runs, one preserved invalid attempt and a
separate request-ID replay probe; one run had a lost response and the later two
did not. SC-03 and SC-04 each have two
measured local runs. These are local samples, so the scenario documents state
exactly what they support. Designs, fixture tests and live observations have
separate status.

## Failure Scenarios

| ID | Scenario | Method | Status |
|---|---|---|---|
| SC-01 | AZ failure | Stop or partition a zone-labeled kind worker; Tawira spread across zones | Baselines `sc01c3`/`gdsc01`: 60 s RTO; ADR-0005 comparison `sc01d`: 90 s, all criteria passed ([results](docs/scenarios/SC-01-zone-loss.md)) |
| SC-02 | Database failure | Local host database stop/restore first; egress fault as a separate comparison | Three local runs: 510 s fault-relative / 30 s DB-ready-relative RTO; one lost response in `sc02b`, none in `sc02c` or `gdsc02`; replay probe passed ([results](docs/scenarios/SC-02-database-failure.md)); volume-loss restore drill: 150 acknowledged sales lost after a 187 s-old backup ([drill](docs/evidence/review/2026-11-09-volume-loss-drill.md)) |
| SC-03 | DNS failure | Chaos Mesh DNSChaos against the load pod's Tawira Service lookup | Measured three times: 90 s RTO in all three; 17, 25 and 12 lost responses; `sc03d` replay recovered 12 of 12 by request ID ([replay](docs/evidence/review/2026-11-09-sc03d-replay.md)) |
| SC-04 | Certificate expiration | Disposable local TLS boundary with an expired X.509 certificate | Measured twice: 90 s HTTPS recovery RTO in both runs; zero lost responses |
| SC-05 | IAM compromise | Synthetic tabletop fixture | [Rehearsal passed; no live revocation claimed](docs/scenarios/SC-05-iam-compromise.md) |
| SC-06 | Secrets leak | Tabletop, synthetic-secret detection and rotation drill | [Synthetic rehearsal passed; no real rotation claimed](docs/scenarios/SC-06-secrets-leak.md) |
Not every scenario maps to a chaos tool, and this repo says so rather
than pretending otherwise. SC-05 and SC-06 are tabletop exercises. Zones
are node labels on one machine, not independent fault domains, so loss
of the database's own zone cannot be simulated (see
[ADR-0001](docs/adr/ADR-0001-local-kind-cluster-as-failure-domain.md)).

---

## Architecture Diagram

```mermaid
graph TB
    subgraph "Single host (local machine)"
        subgraph "kind cluster: atlas-resilience"
            subgraph "zone-a"
                P1[Tawira pod]
            end
            subgraph "zone-b"
                P2[Tawira pod]
            end
            subgraph "zone-c"
                P3[Tawira pod]
            end
            CM[Chaos Mesh 2.8.3]
        end

        SB[(Supabase CLI stack<br/>Docker, host-side)]
        SCRIPTS[Scripted host faults<br/>docker stop / pause / network]

        subgraph "Phase 3 LGTM stack (Docker Compose)"
            COL[OTel Collector]
            GRAF[Prometheus / Loki / Tempo / Grafana]
            AM[Alertmanager]
            COL --> GRAF
            GRAF --> AM
        end
    end

    P1 -->|PostgREST / Auth / Storage / Realtime| SB
    P2 -->|PostgREST / Auth / Storage / Realtime| SB
    P3 -->|PostgREST / Auth / Storage / Realtime| SB
    P1 -->|OTLP| COL
    P2 -->|OTLP| COL
    P3 -->|OTLP| COL
    CM -.->|PodChaos / NetworkChaos / DNSChaos| P1
    SCRIPTS -.->|container faults| SB
```

---

## Repository Structure

```text
atlas-resilience/
├── .github/
│   ├── workflows/
│   │   └── ci.yml                 # secrets scan via atlas-security
│   └── dependabot.yml
├── cluster/
│   └── kind-config.yaml           # 1 control plane + 3 zone-labeled workers
├── target/
│   └── tawira/
│       ├── tawira.yaml            # Deployment (3 replicas, zone spread) + Service
│       └── .env.example
├── chaos/                         # Chaos Mesh 2.8.3 install values + smoke experiment
├── load/                          # open-loop sale generator + result validator
├── measurements/                  # windows.mjs analyzer + per-run results
├── scripts/                       # SC-01 to SC-04 runners and pod-CIDR check
├── docs/
│   ├── adr/                       # Architecture Decision Records
│   ├── evidence/
│   │   ├── spike/                 # environment spike evidence (S1 to S5)
│   │   └── replica-identity/      # before/after for per-replica metric series
│   ├── scenarios/                 # SC-01 to SC-06 designs and evidence
│   ├── runbooks/                  # SC-01 and SC-02 operator procedures
│   ├── gameday/                   # operating plan and 2026-11-08 session record
│   ├── postmortems/               # SC-01 and Game Day postmortems
│   ├── findings/                  # detection gap and remediation acceptance criteria
│   └── slo-rto-rpo.md             # v0.1 targets and measured SC-01 result
├── .editorconfig
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Technology Choices

| Choice | Why this, not the alternative |
|---|---|
| **kind (3 zone-labeled workers)** over live EKS | Chaos experiments are repeated and iterated on; burst-deploying cloud infrastructure for each one costs money and time. The Kubernetes API surface exercised is the same. See [ADR-0001](docs/adr/ADR-0001-local-kind-cluster-as-failure-domain.md). |
| **Chaos Mesh plus scripted host faults** over a single tool | Chaos Mesh gives declarative, reviewable CRDs for in-cluster faults but cannot reach host-side containers. Scripts cover only what it cannot, and each states why. See [ADR-0002](docs/adr/ADR-0002-chaos-tooling.md). |
| **Tawira (real app)** over a purpose-built sample | A real application produces real findings. A fallback to a minimal app is defined in ADR-0003 if the environment spike fails. |
| **Supabase CLI stack on the host** over Supabase manifests on kind | Tawira uses Postgres/PostgREST, Auth, Storage, and Realtime. Reproducing four services on kind adds plumbing without improving the resilience evidence. |
| **Phase 3 LGTM stack** over a new observability setup | Detection time should be measured with the stack already built, which also exercises it against a containerized workload. |
| **Locally built, unsigned image** over the signed CI image | The CI image bakes in a browser-facing Supabase URL that cannot point at a local backend. The local image sits outside the Phase 2 signing chain, and this is stated, not hidden. |

---

## Deployment Guide

**Prerequisites:** Docker, `kind`, `kubectl`, Node (for `npx supabase`),
a Tawira checkout, and the `atlas-observability` stack running. Scripted
bring-up (`up.sh`) is deliberately deferred until the manual flow is
proven by the spike.

```bash
# 1. Supabase (in the Tawira checkout). Note the publishable and secret keys.
npx supabase start
npx supabase migration up --local   # a restored local DB can lag the code
npx supabase status

# 2. Cluster (in this repo)
kind create cluster --config cluster/kind-config.yaml
kubectl get nodes -L topology.kubernetes.io/zone
docker network inspect kind -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}'
# The IPv4 value is <GATEWAY>: the host as the pods see it.

# 3. Image (in the Tawira checkout). VITE_* is read by the BROWSER, so 127.0.0.1.
export SB_PUB='<publishable key>'
docker build -t tawira:chaos-local \
  --build-arg VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$SB_PUB" \
  --build-arg VITE_SITE_URL=http://127.0.0.1:3000 .
kind load docker-image tawira:chaos-local --name atlas-resilience

# 4. Deploy (in this repo)
cp target/tawira/.env.example target/tawira/.env   # fill in <GATEWAY> and keys
kubectl apply -f target/tawira/tawira.yaml
kubectl -n tawira create secret generic tawira-env --from-env-file=target/tawira/.env
kubectl -n tawira rollout restart deploy/tawira
kubectl -n tawira get pods -o wide
```

The first `apply` creates pods before the secret exists, so they error
until the `rollout restart` picks it up. Expected, not a fault.

**Known limitation: the test bed has a clock.** Tawira blocks reads for non-super-admin users once
a shop's trial ends (`trial_ends_at` plus a 5-day grace). After a long gap between sessions the
load generator can see an empty product list and exit. `target/tawira/seed.sql` pushes the local
trial a year ahead; re-run it before a session if the date is near. Multi-node networking failed
in `sc01a`; whether restarting Docker or the host caused it was never confirmed. Rebuild the
cluster before a run if its networking checks fail.

**Verify sales, not only HTTP status.** TanStack Start can return HTTP 200 with a serialized
application error. Keep the local Tawira image in sync with the local database migrations,
and confirm the smoke summary's `sales_ok` equals `sent` and the tagged sales exist in the
ledger. SC-01's control gate requires a sale UUID. After editing the generator, refresh both
script files before creating a load Job:

```bash
kubectl -n tawira create configmap loadgen-script \
  --from-file=loadgen.mjs=load/loadgen.mjs \
  --from-file=sale-result.mjs=load/sale-result.mjs \
  --dry-run=client -o yaml | kubectl -n tawira apply -f -
```

---

## Current Status

**Built:**
- ADR-0001 to ADR-0004 accepted; ADR-0005 records the next placement comparison.
  ADR-0003's environment spike passed
  all five criteria (results in the ADR)
- Three-zone kind cluster (Kubernetes v1.37.0 node image): one control
  plane and three workers carrying `zone-a`/`zone-b`/`zone-c` labels,
  confirmed with `kubectl get nodes -L topology.kubernetes.io/zone`
- Tawira built locally from its Dockerfile, loaded into the cluster, and
  running as three replicas, one per zone. Login, onboarding, and the
  dashboard work end to end; traces, metrics, and logs reach the Phase 3
  stack; all stacks fit on the development machine without swapping
  (evidence in [`docs/evidence/spike/`](docs/evidence/spike/))

- Chaos Mesh 2.8.3 installation and namespace-isolation smoke test
  ([evidence](docs/evidence/chaos-install/), ADR-0002 amendment)
- SC-01: two unchanged-policy local runs with 60 s sale RTO; the separate
  ADR-0005 comparison `sc01d` met its 90 s RTO and replica-replacement targets;
  earlier invalid attempts retained with the result validator and gated harness
- SC-01 verdicts, postmortem and runbook; SC-02 runner, scenario and runbook
  fixture-tested; three valid database outage runs (`sc02b`, `sc02c`, `gdsc02`) and one
  preserved interrupted attempt (`sc02a`) are committed. SC-03 and SC-04 each
  have two valid local observations with their repeat-specific loss counts.
  SC-05/SC-06 synthetic tabletop rehearsals are recorded; the 2026-11-08 Game
  Day and postmortem are documented separately. No live IAM or secrets rotation
  is claimed

---

## Findings So Far

**Rolling update broke the zone spread (spike S5).** The first deploy
used `topologySpreadConstraints` with `maxSkew: 1`, yet pods landed
2/1/0 across the three zones, which `maxSkew: 1` should prevent
([evidence](docs/evidence/spike/s5-before.txt)). The likely cause is that
old and new ReplicaSet pods share the same label, so the scheduler
counted pods that were about to terminate. Adding
`matchLabelKeys: [pod-template-hash]` produced a 1/1/1 spread on the
next rollout ([evidence](docs/evidence/spike/s5-after.txt)).

Caveats: the cause is a hypothesis that was not isolated further. The
fix gave 1/1/1 on two separate rollouts (the second during the
replica-identity change,
[evidence](docs/evidence/replica-identity/after.txt)). It matters for
SC-01 because a routine deploy could otherwise silently undo the zone
spread the experiment relies on.

**Three replicas produced one metric series.** All pods reported the
same resource attributes, so `nodejs_eventloop_utilization_ratio` was a
single series with three pods running
([before](docs/evidence/replica-identity/before.txt)). Setting
`service.instance.id` from the pod name through the downward API gave
three series distinguished by `exported_instance`
([after](docs/evidence/replica-identity/after.txt)). The label is
`exported_instance` rather than `instance` because Prometheus already
sets `instance` to the scrape target. Without this, per-replica rates
and any "which pod is saturated" question were unanswerable, which would
have undermined SC-01 detection.

Caveats: one run. The cause was inferred from the symptom; the fix is
consistent with it, but the SDK path was not isolated further.

---

## Cost Model

The reported **$0 local test-bed cost** covers kind, Chaos Mesh, Supabase CLI
and the Phase 3 stack on one machine. No AWS resource is created by this repo.
Optional Workers AI usage is outside that claim; record provider usage
separately if that path is exercised.

---

## Design Decisions (ADRs)

| ADR | Decision | Status |
|---|---|---|
| 0001 | Local kind cluster as the failure domain | Accepted |
| 0002 | Chaos Mesh for in-cluster faults, scripted host faults for the rest | Accepted |
| 0003 | Tawira on kind, Supabase CLI stack on the host | Accepted |
| 0004 | Per-replica telemetry identity (`service.instance.id`) | Accepted |
| [0005](docs/adr/ADR-0005-zone-loss-placement-and-eviction.md) | Preserve the measured baseline; test taint-aware placement with shorter eviction separately | Accepted for comparison; not deployed |

---

## Testing Strategy

Nothing here is marked done because a manifest applied cleanly. The S5
finding is the proof of why: the manifest looked correct and the
placement was wrong, and only observing the running cluster showed it.

- **Harness regression checks.** `node --test tests/*.test.mjs` tests real/error
  response classification, the absolute request deadline, control rejection,
  incomplete measurement data, both recovery anchors, ledger UUID matching,
  local DB selection and restoration failures. Tests use local HTTP fixtures
  and command stubs; they do not start a cluster or stop a database.
- **Experiment template.** Every scenario states hypothesis, steady
  state (measured from the Phase 3 Golden Signals), blast radius,
  abort condition, result, and follow-up before it runs.
- **Observed, not assumed.** A result comes from running the
  experiment and capturing output into `docs/evidence/`, not from
  reading configuration.
- **Environment labeling.** Every measurement names the environment it
  came from. Local-cluster numbers show the application's and
  automation's behavior, not AWS service timings.
- **Run counts.** A single run is an observation. A result states how
  many runs it rests on.
- **What the local environment cannot test** is documented per scenario
  rather than omitted.

---

## Monitoring

SC-01 `sc01c3` recorded 70 failed connections and no firing alert series. Its
`HighLatencyP99` series was pending before the fault, then cleared. The failure was
visible to the client while the HTTP 5xx panel stayed at zero. This is a measured
coverage gap, tracked as [F-01](docs/findings/F-01-sale-detection-gap.md), with a
proposed external validated-sale probe, missing/zero-traffic checks, and acceptance
criteria for a later comparison. Remediation has not been deployed.

The [Phase 3 stack](https://github.com/spacecode-art/atlas-observability) has
15 s scrape/evaluation intervals, 5-minute holds on application alerts and 30 s
Alertmanager grouping. About 5.5–6 minutes is a configuration-derived estimate
for a continuously qualifying application alert, not a universal outage-detection
floor; `TargetDown` has a different hold. SC-02's `sc02b` and `sc02c` database runs each measured 510 s
fault-relative recovery and 30 s from confirmed DB readiness, with HTTP 200 application errors
during the outage and no firing alert series in either exported range. `sc02b`
had one lost response; `sc02c` had none. The separate `sc02idem1` replay passed
sequential, concurrent and conflicting request-ID safety checks. These remain
local observations, not a universal availability or idempotency claim.

---

## Threat Model

Known operational risks from this repo's local test setup:

| Finding | Category | Status |
|---|---|---|
| Chaos Mesh holds powerful cluster permissions and ships a dashboard | Elevation of Privilege | Mitigation specified in ADR-0002: pinned version, dashboard not exposed beyond localhost |
| The Supabase CLI stack binds all services to `0.0.0.0`, and Studio and pgMeta have no authentication (stated in the CLI's own output) | Information Disclosure | Accepted risk for local-only use; run on a trusted network or firewall ports 54321-54324 |
| The local image is built outside the Phase 2 signing chain | Tampering | Stated in ADR-0003; image is never pushed |
| Credentials needed to run the target (local Supabase keys; if the Workers AI path is exercised, use a scoped throwaway Cloudflare token, never a production one) | Information Disclosure | `.env` is gitignored; secrets enter the cluster via a Kubernetes Secret created from the local file |

---

## Incident Runbook

[SC-01](docs/runbooks/SC-01-zone-loss.md) covers control gates, manual aborts,
restoration, ledger checks and the observed alert gap.
[SC-02](docs/runbooks/SC-02-database-failure.md) prepares the local
database-only fault; results are recorded in the SC-02 scenario. Each runbook
states what its alerts cover.

---

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every PR
and push to `main`. Secrets scanning consumes `atlas-security`'s reusable
`reusable-secrets-scan.yml` (pinned to `v1.0.4`). A separate Node 22 job runs
`node --test tests/*.test.mjs` using fixtures and command stubs;
it does not start a cluster or inject faults. Dependabot tracks GitHub Actions.

---

## Security Review

- **Secrets scanning** is enforced in CI on every PR.
- **Dockerfile build warnings.** BuildKit flags `SecretsUsedInArgOrEnv`
  for `VITE_SUPABASE_PUBLISHABLE_KEY`. This is a name-pattern match on
  a key that is public by design: `VITE_*` values are embedded in the
  browser bundle, and the Dockerfile states that server-only secrets
  must never be passed as build arguments.
- **No SAST/dependency scanning of Tawira here.** It is scanned in
  `atlas-security`; this repo contains the deployment, load generator, fault
  runners and measurement tools, rather than the application source.

---

## Postmortem Example

The [SC-01 postmortem](docs/postmortems/SC-01-zone-loss.md) covers the valid run,
invalid-run trail, delayed replica replacement and detection gap. The
[2026-11-08 Game Day postmortem](docs/postmortems/2026-11-08-game-day.md) and
[execution record](docs/gameday/2026-11-08-execution.md) document the local
exercise. No video recording was made.

---

## Future Roadmap

Open work, tracked honestly. None of it is claimed as done.

- **F-01 sale-path detection** (owner: `atlas-observability`): a validated-sale probe, a failure-ratio alert and a heartbeat alert, then a notification-delivery drill. Five faults so far produced customer-visible failures with no firing alert.
- **Backups:** automated full-database backup including the `auth` schema, a login test after restore, and continuous archiving for a measured RPO in seconds.
- **Retry-capable client:** make the sale client retry with the same request ID, and measure lost responses falling to zero.
- **Tawira health endpoint:** readiness is a TCP probe and proves only that the process started.
- **SC-07** third-party dependency failure (email, payments): planned, not built.
- **ADR-0005 overlay:** `sc01d` met its criteria; the overlay was not promoted. Decide.
- **Second participant and a recorded Game Day,** with a separately authorized notification drill.
- **AWS reference design and an optional cloud burst demo:** separate scope, not a prerequisite for the local Phase 5 proof.

---

## Benchmarks

Latest baseline SC-01 result: `gdsc01`, **60 s RTO**, 30 s resolution. The
separate `sc01d` overlay comparison measured **90 s** and met its predeclared
criteria. Both runs reconciled all acknowledged sales without duplicates
([details](docs/scenarios/SC-01-zone-loss.md)). Each result states its
environment, run count and detection evidence. Local-environment numbers will not be presented as cloud
service timings.

---

## Demo Video

[Watch the 4-minute SC-04 demo](https://drive.google.com/file/d/1SHNW-F4W-AL_ygm3cPUmxkAM6TDuw5Ri/view?usp=sharing)

A live run of SC-04 (expired TLS certificate), run `demo2`, recorded on the local kind cluster. It shows the control phase, the fault, the certificate replacement and recovery, and the reconciliation: 1,950 sent, 1,609 validated sales, 1,609 database rows, with 0 missing and 0 duplicates. It also shows the `sc03d` replay result, where 12 sales were recorded but never acknowledged and all 12 were recovered. The recording is one local observation, not a general claim. The evidence is in `measurements/results/demo2/` and `measurements/results/sc03d/`. The shot list is in [`docs/demo/SHOT-LIST.md`](docs/demo/SHOT-LIST.md); the recording will show a live run and the committed evidence.

---

## Documentation

Additional documentation is available under the `docs/` directory.
Architecture decisions are recorded as ADRs in `docs/adr/`.

## Contributing

Please read `CONTRIBUTING.md` before submitting changes.

## License

This project is licensed under the MIT License.
