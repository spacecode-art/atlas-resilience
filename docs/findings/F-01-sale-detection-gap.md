# F-01: Client sale failures are absent from server 5xx alerts

## Status
Open, first observed in SC-01 `sc01c3` on 2026-11-02 and reproduced in the
2026-11-08 SC-02 outage run `gdsc02`. Remediation is designed; no Phase 3 rule,
exporter or notification route was changed in this work.
Owner: the `atlas-observability` change, verified with `atlas-resilience` drills.

## Evidence
`measurements/results/sc01c3/client.jsonl` has 70 transport failures. Its
`alerts-range.json` has no firing series; `HighLatencyP99` was pending before
the fault and cleared. The fixed-window dashboard shows zero server 5xx.
The fault lasted about eight minutes; client failures were sent only during
its first 44 s. These are different durations.

`sc01c2` exposed another boundary: HTTP 200 serialized application errors can
occur with zero recorded sales. A shorter hold on the existing HTTP 5xx rule
would not detect either failure mode. An eight-minute loss of a worker is not
an eight-minute application outage. A five-minute hold is not a universal
six-minute detection floor: firing depends on the rule expression, the series
and its continuous active duration. `TargetDown` has a separate two-minute hold.

`measurements/results/gdsc02/` adds a repeat: 2,431 HTTP 200 application errors
occurred while Postgres was stopped or becoming ready. The runner's sampled
timeline had no firing alert series. This supports the same business-outcome
coverage gap but does not show whether an existing expression qualified
continuously between samples. `gdsc01` and `sc01d` did not capture alert-range
exports, so no alert verdict is derived from those runs.

## Remediation before claiming coverage
1. In `atlas-observability`, add an independent probe of the sale path. A test
   account, isolated product/stock and tag ledger are required because this is
   a write. Export attempts and validated outcomes, plus a probe heartbeat.
   HTTP 200 alone is not success. Prefer probing through a different network
   path than the application, with a documented scope and stock cleanup plan.
2. Add a warning for a sustained short-window probe failure ratio and a
   heartbeat-absence alert. Candidate: >5% failures over 1 minute with a
   30 s hold, plus absent/stale heartbeat for 60 s. Tune only through recorded
   comparisons; alert labels and traffic thresholds must be specified.
3. Add an expected-traffic check. An existing counter with zero increase is
   different from a missing series; `absent()` alone cannot detect both.
   Suppress expected idle periods explicitly, rather than assuming all zero
   traffic is an outage. Keep Collector scrape health separate from app health.
4. Evaluate paired short/long-window sale-error-budget burn alerts once a real
   sale SLI is exported. Burn-rate math on server 5xx alone leaves this gap.
5. Verify firing, recovery and Alertmanager routing using a test receiver in a
   separately authorized notification drill. No test messages were sent here.

## Acceptance evidence
Before closing F-01, store rule tests and a new run ID for each case:

| Case | Required observation |
|---|---|
| Healthy expected traffic | Probe/heartbeat present; no false warning. |
| Similar ~44 s client failure burst | Failure visible in probe series; determine whether warning qualifies; do not promise a page for every short burst. |
| Sustained validated-sale failure | Candidate warning fires within 120 s of probe-observed sustained failure, and resolves after recovery. |
| Application error inside HTTP 200 | Counted as failure; success counter does not increase. |
| Probe disappears / app traffic is absent / rate is zero | Separate tested evaluations for all three; healthy idle periods handled. |
| SC-02 database loss and restore | Compare client SLI, exported metrics, alert states and ledger before any claim about detection. |

The 120 s probe warning is a proposed remediation target, not a measured MTTD
or a promise that Slack delivery meets it. Save before/after rule evaluations
and notification timestamps separately.

References: [Prometheus alert rule semantics](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
and [Google SRE alerting on SLOs](https://sre.google/workbook/alerting-on-slos/).
