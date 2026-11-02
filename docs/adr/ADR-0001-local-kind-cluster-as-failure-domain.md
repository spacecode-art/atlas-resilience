# ADR-0001: Local kind cluster as the failure domain

## Status and record correction
Accepted for the existing local test environment. Record corrected 2026-11-02.
The file previously contained a copy of the proposed workload ADR-0003, including
its incorrect heading. Both original commits (`2c3885d`, `8e5da73`) contain that
copy. This correction documents the environment already used by the manifests
and evidence; it does not claim this text was written before the experiments.
The workload decision and spike remain in [ADR-0003](ADR-0003-target-workload.md).

## Context
Phase 5 of the Atlas Path requires scenario designs, local fault injection,
measured recovery and a recorded Game Day. Repeated fault experiments need a
resettable environment without an always-on cloud bill. The application and
Phase 3 observability stack already run locally.

## Decision
Use `cluster/kind-config.yaml`: one control plane and three worker containers.
Label workers `zone-a`, `zone-b`, `zone-c` and spread three Tawira replicas across
them. Use host-side Docker faults for kind nodes, and Chaos Mesh for supported
in-cluster faults as specified by ADR-0002. Supabase and the observability stack
remain outside kind, on the same host.

## Alternatives and tradeoffs

| Environment | Decision |
|---|---|
| Local multi-worker kind | Chosen: repeatable node/container failure and Kubernetes scheduling behavior with the existing machine. |
| Single-node Kubernetes | Insufficient for observing replacement across worker/zone labels. |
| Live multi-AZ AWS deployment | Optional later portability demonstration; requires cost, teardown and a separately designed fault scope. |
| Docker Compose only | Retained for the database/telemetry; does not exercise Kubernetes placement and endpoint removal. |

## Boundaries and evidence
A worker kill removes one container, not a real AWS availability zone. All
workers, the control plane, the DB and telemetry share a host and its resources.
The single control plane is outside SC-01's fault. DB faults are separately
scoped in SC-02. None of these runs proves cloud-zone independence, a resilient
control plane, cross-region recovery or database-volume durability.

`docs/evidence/spike/s1-cluster.txt` records the topology;
`measurements/results/sc01c3/` records one worker-loss experiment. Resetting a
cluster is an environment repair, not application recovery. A changed node
network identity or an invalid control disqualifies a run. Preserve failed
attempts and label their limits rather than treating setup success as resilience.
