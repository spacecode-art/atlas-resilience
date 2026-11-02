# SC-02: Local database unavailable, then restored

## Status
Runner and measurement tools fixture-tested 2026-11-02. **Not run against the live stack.** No detection or recovery result is claimed.
Run only in a dedicated local session after the [runbook](../runbooks/SC-02-database-failure.md)
preflight. Keep these predictions and the original targets visible after execution.

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
Use a fresh ID such as `sc02a`. Save current image/migration identifiers,
control and complete client logs, events (`FAULT`, `DB_READY`, restore), sampled
pod/DB/alert timelines, ledger and UUID reconciliation, Prometheus query ranges,
fixed-window dashboard, restarts before/after, and application errors.
The [runbook](../runbooks/SC-02-database-failure.md) documents explicit read-only
check, 150-sale smoke and fault modes, captured files and manual recovery.
Fixture checks cover preflight refusal, restoration failures, incomplete
measurement rejection and UUID reconciliation. They are not live fault evidence.
No SC-02 alert, MTTD, RTO, RPO or hypothesis verdict has been measured yet.
