# SC-03: service-name DNS failure

## Status

Design prepared 2026-11-07. **Not run.** The experiment manifest is a reviewed
fixture, not evidence that DNS injection or recovery has worked in this cluster.
The Chaos Mesh DNS server is enabled in `chaos/install/values.yaml`, but the
selection and status conditions must be verified during a dedicated session.

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

No live result, alert timing, RTO, RPO or hypothesis verdict exists yet.
Chaos Mesh documents DNSChaos `error` behavior, pattern matching and the
required DNS server; this repository's 2.8.3 install enables that component,
but those facts are prerequisites, not a local observation.
