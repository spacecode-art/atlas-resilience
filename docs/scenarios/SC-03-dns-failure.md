# SC-03: service-name DNS failure

## Status

Design prepared 2026-11-07. Two valid local runs (`sc03b`, `sc03c`) completed
on 2026-11-07; `sc03a` is preserved as an invalid selector run. Both valid runs
recovered in 90 seconds, but recorded 17 and 25 lost responses respectively.
These are local observations, not a general DNS-availability claim. The Chaos
Mesh DNS server is enabled in `chaos/install/values.yaml`, but selection and
status conditions must be verified during each dedicated session.

## Fault and blast radius

Return DNS errors for the Tawira Service name used by the load generator:
`tawira.tawira.svc.cluster.local`. The selector is the `app=loadgen` Job pod,
so Tawira replicas and CoreDNS are outside the injection target. The load Job
template now carries that label. The database, Supabase API IP, node network
and other namespaces are out of scope.

The short `http://tawira:3000` URL is resolved through the namespace search list.
The experiment must first confirm that the resolver asks for the selected FQDN;
otherwise the pattern is not testing the intended name. Do not broaden the
pattern to all names: that would turn a service-name fault into a general DNS
outage and invalidate the blast-radius claim.

## Control and hypotheses

Use the same validated-sale contract as SC-01 and SC-02. Re-run the 150-sale
smoke, then collect a 120-second control at 5 RPS. Require at least 99.5%
validated sales, p95 at most 1 s, p99 at most 2 s, and at least 90% of planned
requests. Capture a resolver probe and the Chaos Mesh status before injection.

| ID | Prediction | Refuted or unresolved if |
|---|---|---|
| H1 | Requests that need the Tawira Service name fail while DNSChaos is selected and injected; the failure may be a resolver error or a client connection error. | Validated sales continue at the control rate while the selected DNS fault is confirmed. Check whether the client reused a connection or bypassed DNS before calling this refuted. |
| H2 | Removing DNSChaos restores new name resolution without restarting Tawira or the load pod. | Recovery requires a pod/app restart, or the resolver remains broken after the experiment is deleted. |
| H3 | No database rows are created for requests without a validated response, and no tag is duplicated. | Ledger reconciliation finds a missing acknowledged UUID or duplicate tag. |
| H4 | Existing server-side alerts may not identify a client-only resolver failure. | A qualifying alert fires; record its expression, timing and whether it measures the client failure rather than merely pod health. |

RTO is measured from the DNSChaos injection/removal timestamps using the same
30-second complete-window analyzer. Report the fault-relative outage and the
recovery after the experiment is deleted separately. A partial log, an
unconfirmed Chaos Mesh selection, or a client that did not perform fresh DNS
lookups makes the run invalid rather than producing an RTO.

## Experiment and observation

The reviewed fixture is [`chaos/experiments/sc03-dns-error.yaml`](../../chaos/experiments/sc03-dns-error.yaml).
The attended runner is [`scripts/sc03-dns-loss.sh`](../../scripts/sc03-dns-loss.sh);
`--check` is read-only and `--run` is the only mode that creates a load Job or
applies DNSChaos. It refuses a stale ConfigMap, active Job, existing experiment,
unready injector, unhealthy replicas or an invalid pod CIDR before injection.
At runtime it adds a unique `sc03-run=<RUN_ID>` pod label and overlays that
selector into the DNSChaos object. This avoids selecting completed load pods
from an earlier run, which would make Chaos Mesh report `no running task found`.
The runner also extends the object duration beyond the planned fault window and
deletes it explicitly, so automatic expiry cannot be mistaken for cleanup.
Before applying it:

1. Confirm the current context, namespace annotation, Chaos DNS Server pod and
   three Ready Tawira replicas. Confirm no other Chaos experiment is active.
2. Start a fresh load Job with a unique run ID and capture the resolver result
   from the load pod for `tawira.tawira.svc.cluster.local`.
3. Apply the fixture and wait for `status.conditions` to show both `Selected`
   and `AllInjected` true. If either condition is false or absent, stop; the
   client data cannot be called a DNS experiment.
4. Observe client logs, ledger, pod restarts, resolver probes, Prometheus alert
   state and Chaos Mesh events. Do not infer DNS failure from HTTP 5xx alone.
5. Delete the DNSChaos object, confirm the fault is removed, run the resolver
   probe again and observe complete recovery windows. Save the object, status,
   events and exact UTC query range with the client and ledger artifacts.

## Abort and cleanup

Abort on any target-selection mismatch, CoreDNS impact, database or host fault,
duplicate/missing sale UUID, resource pressure, lost observability or an
unexpected pod restart. Delete the named DNSChaos object first; if deletion
does not restore resolution, stop the load Job and follow the Chaos Mesh
cleanup procedure. Never delete CoreDNS or edit cluster DNS configuration as a
recovery shortcut. A manually restarted pod is an intervention and invalidates
the automatic-recovery hypothesis.

## Result

### sc03a: invalid before injection was verified (2026-11-07)

The 120-second control passed with 637 requests and a 100% validated-sale
ratio. During the fault phase, the DNS server logged repeated errors for
`tawira.tawira.svc.cluster.local` from the live load pod, but the DNSChaos
status reported `Selected=True` and `AllInjected=False`. Its container record
also selected the completed `sc02smk7` load pod and failed with `no running task
found`. The runner aborted and deleted the DNSChaos object and load Job. This
run is invalid for RTO or hypothesis verdicts; the failure exposed an overly
broad selector and is preserved in `measurements/results/sc03a/`.

### sc03b: measured (2026-11-07, one local run)

The 120-second control passed at 637 requests, 100% validated sales, p95 652 ms
and p99 965 ms. The corrected runner selected only the `sc03-run=sc03b` pod;
the DNS error phase lasted 60 seconds, then the object was deleted and recovery
was observed for 180 seconds. The load pod stayed Running with zero restarts.

| Measure | Observed |
|---|---|
| Requests sent | 1,950 of 1,950 planned |
| Validated sale successes / database rows | 1,756 / 1,773 |
| Clean failures | 177 |
| Lost responses | 17 database rows without a validated client acknowledgement |
| Acknowledged missing/mismatched / duplicate tags / unmatched DB tags | 0 / 0 / 0 |
| Failure shape | 156 30-second timeouts, 12 `EAI_AGAIN` resolver errors, 26 HTTP 200 application errors |
| Failure send times relative to fault | +1 to +61 s |
| Success-ratio RTO | **90 s**, 30 s resolution; recovery windows at +90 s and later were 100% |
| Resolver probe before/after | `10.96.109.75` / `10.96.109.75` |
| Alerts | No firing `ALERTS{alertstate="firing"}` series in the 08:51–08:59 UTC query; `HighLatencyP99` remained pending |

The 17 lost responses are the most important result: the database committed a
sale while the client did not receive a validated acknowledgement. The run had
no duplicate rows and no acknowledged UUID mismatch, but a caller retrying such
a request could risk a second sale. The generator did not retry, so retry
safety is not established. This is a business-outcome finding, not merely a DNS
availability number.

Hypothesis verdicts for this one run:

| ID | Verdict | Evidence and limit |
|---|---|---|
| H1 | Supported | DNS errors and request failures occurred during the selected fault; no failure was sent after +61 s. |
| H2 | Supported for this run | Resolver returned the same Service IP after deletion; no app restart was needed; RTO was 90 s. One run cannot establish automatic recovery generally. |
| H3 | Partly supported | No acknowledged UUID was missing and no duplicate tag appeared, but 17 lost responses were recorded. |
| H4 | Not refuted | No firing alert series appeared; `HighLatencyP99` was already pending. The alert query is corroboration, not notification-delivery proof. |

Evidence is preserved in `measurements/results/sc03b/`, including the client
log, ledger, reconciliation, windows, resolver probes, generated object,
Prometheus range queries and timeline. The status-condition snapshot was added
after this run; the runner nevertheless reached the DNS phase only after its
`Selected`/`AllInjected` gate passed.

### sc03c: measured repeat (2026-11-07)

The read-only preflight and 105-second control passed. DNSChaos selected only
the run-labelled load pod (`Selected=True`, `AllInjected=True`), returned DNS
errors for the 60-second fault phase, and was explicitly deleted before the
recovery observation. The load pod stayed Running with zero restarts and the
resolver returned `10.96.109.75` before and after the fault.

| Measure | Observed |
|---|---|
| Requests sent / planned | 1,350 / 1,350 |
| Validated sale successes / database rows | 1,114 / 1,139 |
| Clean failures | 211 |
| Lost responses | 25 database rows without a validated client acknowledgement |
| Acknowledged missing/mismatched / duplicate tags / unmatched DB tags | 0 / 0 / 0 |
| Failure shape | 189 30-second timeouts, 12 `EAI_AGAIN` resolver errors, 35 HTTP 200 application errors |
| Failure send times relative to fault | +2 to +69 s |
| Success-ratio RTO | **90 s**, 30 s resolution |
| Alerts | No firing series was recorded in the preserved run artifacts |

The repeat confirms the same recovery time as `sc03b`, while showing that the
lost-acknowledgement risk is not a one-run anomaly: the two runs recorded 17 and
25 lost responses. H1 and H2 are supported for the two runs; H3 remains only
partly supported because no duplicate or acknowledged mismatch occurred but
lost responses did. The generator does not retry, so retry safety remains
unresolved. H4 is not refuted by the local alert query; this is not proof of
notification delivery behavior.

Evidence is preserved in `measurements/results/sc03c/`, including the client
log, ledger, reconciliation, windows, DNSChaos status/object, resolver probes,
events and timeline.
Chaos Mesh documents DNSChaos `error` behavior, pattern matching and the
required DNS server; this repository's 2.8.3 install enables that component,
but those facts are prerequisites, not a local observation.
