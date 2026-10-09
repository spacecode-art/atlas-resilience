# ADR-0004: Per-Replica Telemetry Identity

## Status
Accepted

## Date
2026-10-09

---

## Context
Tawira runs as three replicas that push OTLP telemetry through the Phase 3
Collector, which exposes it to Prometheus on one scrape target. With pull
scraping, Prometheus adds an `instance` label per target. Here it cannot:
every pod arrives through the same Collector endpoint, so replica identity
has to come from the telemetry itself.

The telemetry carried only `service.name` and `service.version`. Hypothesis
from static reading: the three replicas' series share identical label sets
and collapse into one series. Phase 3 ran a single instance, so the defect
could not appear there.

Test: `count(nodejs_eventloop_utilization_ratio)`, a gauge every pod emits
regardless of traffic. Two replicas cannot be seen through HTTP metrics
alone, because a port-forward reaches only one pod.

## Options considered

| Option | Verdict |
|---|---|
| **Set `OTEL_RESOURCE_ATTRIBUTES=service.instance.id=$(POD_NAME)` via the downward API** | Chosen. Manifest-only; no application change. |
| Add the attribute in Tawira's `instrumentation.mjs` | Held in reserve. Needed only if the SDK ignored the variable. It did not. |
| Scrape pods directly with Prometheus service discovery | Rejected here. Changes the Phase 3 architecture (push via Collector) for one label. |

## Decision
Inject `POD_NAME` from `metadata.name` and set `OTEL_RESOURCE_ATTRIBUTES`
to `service.instance.id=$(POD_NAME)` in the Tawira Deployment.

## Result
Evidence: `docs/evidence/replica-identity/`.

| | Before | After |
|---|---|---|
| `count(nodejs_eventloop_utilization_ratio)` | 1 | 3 |
| Per-pod label | none | `exported_instance` = pod name |

One stale series without the label appeared in the first post-rollout
query and was gone by the next capture, consistent with the Collector's
roughly five-minute series expiry.

## Consequences
- Series are now distinguishable per replica, so experiments can show which
  pod a fault hit and how the others behaved.
- The Prometheus label is `exported_instance`, not `instance`. Dashboard
  queries and legends that group by `exported_job` still show three
  indistinguishable lines for per-pod panels. Fixing them belongs in
  `atlas-observability`, as its own change.
- Cardinality grows with replica count and with pod churn: every rollout
  creates new series. Acceptable at this scale; worth revisiting for large
  fleets.
- Dashboard panels were validated at one replica in Phase 3. Rates across
  three replicas are not yet re-verified and are checked before relying on
  them in SC-02.
- Limits: one rollout observed for the fix, one metric used as the probe.