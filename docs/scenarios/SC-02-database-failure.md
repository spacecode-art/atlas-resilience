# SC-02: Local database unavailable, then restored

## Status
Runner and measurement tools fixture-tested 2026-11-02. The live read-only
preflight and 150-sale smokes passed on 2026-11-07 (`sc02smk9`, `sc02smk10`).
Two complete database outage runs (`sc02b`, `sc02c`) are measured; the earlier
interrupted attempt (`sc02a`) is retained as invalid evidence. The first valid
run had one lost response and the repeat had none. These remain local samples,
not a general availability claim. Run only in a dedicated local session after
the [runbook](../runbooks/SC-02-database-failure.md) preflight.

## Fault and blast radius
Cleanly stop only the explicitly selected local Supabase Postgres container for
480 seconds, then start that same container with its existing volume. This is a
scripted host fault under ADR-0002 because the DB is outside kind. Do not stop
the whole Supabase stack, remove containers/volumes, reset data, pause the host,
or touch hosted Supabase. Authentication/PostgREST that depend on this DB may
also fail; that dependence belongs in the blast radius. The three application
workers and observability stack remain running. A later egress partition needs
a separate run ID: it is not interchangeable with database shutdown.

## Control and timeline
Use the `sc01c3` image/source as the starting reference, recording current IDs
and migration versions. Re-run the test seed. Require 20 visible products, a
150-sale smoke with 150 matching UUIDs in the ledger, three healthy replicas,
and a 120 s control at 5 RPS meeting >=99.5% validated sales, p95 <=1 s, p99 <=2 s,
and >=90% expected request volume. The load must authenticate before the stop.

Planned load: 5 RPS for 1,350 s (6,750 requests): 120 s control, 480 s unavailable,
600 s recovery and 150 s margin for stop/start/readiness overhead. If overhead
consumes the required recovery window, mark the run incomplete rather than
claiming the unused margin is observation. Hold time is measured after stop.

## Hypotheses and predeclared targets

| ID | Prediction / question | Refuted or unresolved if |
|---|---|---|
| H1 | DB-dependent sales fail during confirmed DB unavailability; failure shape may be timeout, non-200, or an application error in HTTP 200. | Acknowledged sales are recorded while the DB is confirmed unavailable; investigate fault identity before interpretation. |
| H2 | Tawira resumes validated sales automatically after Postgres is ready, with no application restart. | Restarts/manual intervention needed, or no sustained recovery within the target. |
| H3 | Recovery is within 300 s of confirmed database readiness; also report total outage-relative RTO. | First sustained >=99.5% 30 s window starts >300 s after DB readiness, or the observation is too short. |
| H4 | No acknowledged sale is missing and no tag appears more than once. | Missing/mismatched UUID or duplicate row; stop and investigate. |
| H5 | Existing alerts may miss business failures. Test missing series, zero rates and HTTP 200 application errors as distinct outcomes. | This is a question, not a claim that database loss removes all request telemetry. Record whichever states occur. |
| H6 | For a continuously qualifying current rule, proposed MTTD is <=420 s from fault. | No firing alert by +420 s despite sustained sale failure; identify whether the expression qualified before blaming hold time. |

Do not change these targets after viewing the result. Record both fault-relative
and DB-ready-relative offsets. `windows.mjs` uses the logged `DB_READY` event
to calculate a second, independent 30 s grid; do not subtract rounded RTOs.
Only complete observed windows establish recovery; incomplete logs are rejected. `sc01c3` is a control reference, not evidence for SC-02.

## Abort and recovery
An attended operator is required. `scripts/sc02-db-loss.mjs` automates the gate,
stop/restore and sampled checks; SIGINT/SIGTERM and command failures after a stop
attempt trigger restoration. Process/host loss can defeat cleanup. Abort on duplicates or
acknowledged missing sales, host pressure, unexpected non-test data, loss of
observability, the wrong fault target, or an unexpected application/cluster
failure independent of the intended DB outage. Client failures during the
planned DB stop are expected and do not use SC-01's >50% abort criterion.
Always start the selected DB on exit, retain its volume, wait for readiness,
verify authenticated reads and validated writes, then confirm all replicas.

## Evidence and results

### sc02smk7: valid smoke (2026-11-07)

The read-only preflight passed after refreshing the load-script ConfigMap. The
30-second, 5 RPS Job completed with 150 requests and 150 validated sale UUIDs;
all 150 matched exactly one ledger row. There were no clean failures, lost
responses, duplicate tags or unmatched database tags. Client latency was
228/729/1,006 ms at p50/p95/p99. This is a workload and ledger control, not a
database-failure result. Raw artifacts are preserved in
`measurements/results/sc02smk7/`.

### sc02smk9: valid smoke (2026-11-07)

After restoring the observability stack and re-running the read-only preflight,
the 30-second smoke completed with 150 requests, 150 validated sale UUIDs and
150 matching ledger rows. It recorded no clean failures, lost responses,
duplicate tags or unmatched database tags. Client latency was 254/1,031/1,694
ms at p50/p95/p99. This is a workload and ledger control, not a database-failure
result. Raw artifacts are preserved in `measurements/results/sc02smk9/`.

### sc02a: invalid interrupted run (2026-11-07)

The control gate passed and the database stopped at 09:47 UTC, but the attended
runner process was terminated during the declared 480-second hold. The database
was manually started at 10:04 UTC and readiness was confirmed. The observability
containers were also found exited and restored before the next preflight; this
run cannot establish outage recovery, RTO, RPO or alert behavior. Its partial
artifacts and the operator timeline are retained in `measurements/results/sc02a/`.

### sc02b: valid local database outage (2026-11-07)

The selected local Postgres container was stopped for the declared 480 seconds
and started again without restarting the Tawira deployment. The load ran at
5 RPS for 1,350 seconds: 6,750 requests, 4,305 validated sales and 2,445
application-level failures returned as HTTP 200. The failure body was the
Tawira access-verification error for 2,444 requests; one request reported that
the sale was recorded but its receipt could not be loaded. The complete raw
client log, ledger export, sampled timeline and Prometheus ranges are in
`measurements/results/sc02b/`.

| Measure | Observation |
|---|---:|
| Control gate | Passed: 602 sent, 100% validated, p95 650 ms, p99 1,082 ms |
| DB stop / ready | 10:09:21Z / 10:17:26Z |
| Fault-relative recovery | 510 s, 30 s window resolution |
| DB-ready-relative recovery | 30 s, 30 s window resolution; within the 300 s target |
| Database reconciliation | 4,306 rows, 4,306 distinct tags, 0 duplicate or unmatched tags |
| Lost response | 1 sale response was not matched to a validated acknowledgement |
| App restart | None during `sc02b`; replicas remained Ready |
| Alert range | No firing series; `HighLatencyP99` was pending in one exported range |

The 510-second fault-relative RTO includes the full database hold and the
30-second recovery window. The independent DB-ready grid begins at 93.29% in
the first window and reaches a complete 100% window at +30 seconds. The analyzer
also counts 33 failures after the `RESTORE` event; 10 of those were sent after
the later `DB_READY` event. These are application errors during the readiness
transition, not acknowledged sales.

H1 is supported: confirmed database unavailability produced application-level
sale failures. H2 is supported for this run: validated sales resumed without an
application restart. H3 is supported against the DB-ready target, while the
fault-relative result is reported separately. H4 remains unresolved for the
outage run: the database contains every distinct sale tag, but one response was
lost. The separate `sc02idem1` replay supports request-level retry safety for
this endpoint, but does not turn the outage run into a zero-loss result. H5 is
observed as an alert gap in this run: no firing
series was exported while the business operation failed, and `HighLatencyP99`
was only pending. H6 is unresolved because no firing alert was recorded; this
run cannot establish whether the rule qualified continuously or whether alert
delivery was the limiting step. The repeat below confirms the recovery anchors
but does not turn local evidence into a general availability claim.

### sc02c: valid local database outage (2026-11-07)

A fresh 30-second smoke (`sc02smk10`) passed before the fault. The same selected
Postgres container was stopped for the declared 480 seconds and started again
without restarting Tawira. The load ran at 5 RPS for 1,350 seconds: 6,750
requests, 4,306 validated sales and 2,444 HTTP 200 application-level failures.
All failures were the access-verification error observed while the database was
unavailable or becoming ready. The complete client log, ledger export, event
and timeline logs, Prometheus ranges and reconciliation are in
`measurements/results/sc02c/`, including the fixed-window
[Grafana dashboard capture](../../measurements/results/sc02c/dashboard-run.png).

| Measure | Observation |
|---|---:|
| Control gate | Passed: fresh `sc02smk10` smoke; load control also passed |
| DB stop / ready | 2026-11-07 16:18:58Z / 16:27:02Z |
| Fault-relative recovery | 510 s, 30 s window resolution |
| DB-ready-relative recovery | 30 s, 30 s window resolution; within the 300 s target |
| Database reconciliation | 4,306 rows, 4,306 distinct tags, 0 duplicate or unmatched tags |
| Lost response | 0 |
| App restart | None during `sc02c`; replicas remained Ready |
| Alert range | No `ALERTS{alertstate="firing"}` or `HighLatencyP99` series in the exported ranges |

The repeat reproduces the first run's recovery anchors while improving the
acknowledgement result: every database row has exactly one validated client
acknowledgement in `sc02c`. The run still produced 29 failed requests after the
restore command and before the later `DB_READY` event; those are transition
errors, not acknowledged sales.

H1 is supported: confirmed database unavailability produced application-level
sale failures. H2 is supported for this run: validated sales resumed without an
application restart. H3 is supported against the DB-ready target. H4 is
supported for this repeat, but the combined SC-02 evidence remains bounded by
the one lost response in `sc02b`. H5 is observed as the same alert gap: neither
exported range contained a firing series while the business operation failed.
H6 remains unresolved because a missing firing series does not distinguish rule
qualification from notification or query coverage.

### sc02idem1: request-ID replay (2026-11-07)

The targeted replay probe sent sequential duplicates, concurrent duplicates and
conflicting payload reuse. Sequential and concurrent duplicates each produced
one ledger row and both responses returned the same sale UUID. Reusing a
`requestId` with a new tag and quantity produced one ledger row; the second
request returned an HTTP 200 application error and created no second row. The
verifier reported zero safety failures and zero contract gaps. This is one
local endpoint observation and supporting evidence for retry handling, not a
universal idempotency guarantee. Raw responses, the read-only ledger export and
script provenance are in `measurements/results/sc02idem1/`.

Use a fresh ID such as `sc02c`. Save current image/migration identifiers,
control and complete client logs, events (`FAULT`, `DB_READY`, restore), sampled
pod/DB/alert timelines, ledger and UUID reconciliation, Prometheus query ranges,
fixed-window dashboard, restarts before/after, and application errors.
The [runbook](../runbooks/SC-02-database-failure.md) documents explicit read-only
check, 150-sale smoke and fault modes, captured files and manual recovery.
Fixture checks cover preflight refusal, restoration failures, incomplete
measurement rejection and UUID reconciliation. They are not live fault evidence.
