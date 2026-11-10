# SC-01: Loss of one zone's worker

## Status
Designed 2026-10-16. Two unchanged-policy baseline runs completed: `sc01c3`
on 2026-11-02 and `gdsc01` during the 2026-11-08 Game Day. The separate
ADR-0005 overlay comparison `sc01d` also completed on 2026-11-08. Earlier
attempts are preserved below. Predictions below are written before the run so
they can fail.

## Fault
`docker kill` on the kind worker `atlas-resilience-worker3` (zone-c), held for 8 minutes, then
`docker start`. Script: `scripts/sc01-zone-loss.sh`. It is a script, not a Chaos Mesh CRD, because
Chaos Mesh acts through a daemon on the node and cannot remove the node itself (ADR-0002).
SIGKILL is used instead of `docker stop` so the kubelet gets no clean shutdown, as in a real zone
loss.

## Steady state
Reference: `base2` (`docs/slo-rto-rpo.md` section 1): 5 RPS, 3000 of 3000 at 200,
p50/p95/p99 = 97/410/761 ms. The run's own first 120 s (no fault) is the control and is compared to
`base2`; a control that differs from `base2` invalidates the run.

## Blast radius
In: one kind worker container, the one Tawira replica on it, any other pod on it.
Out: the host, Supabase, the other workers, the control plane, the load generator (pinned to
`atlas-resilience-worker2`).
Preflight refuses to run if the victim hosts a CoreDNS pod, because cluster DNS lookups would then
fail for all traffic and the result would not be SC-01.

## Hypotheses
| ID | Prediction | Refuted if |
|---|---|---|
| H1 | Until the node is marked NotReady and its endpoint leaves the Service, about one third of requests are routed to the dead replica and fail. Window expected at 40 to 60 s (read the real grace period from `before.txt`). That is about 67 to 100 failed requests of about 5,400. | Failures last past 120 s after the fault, or exceed one third of requests in any window. |
| H2 | Failure mode is unknown: either a client timeout (about 30,000 ms) or a fast connect error. Recorded, not predicted. | n/a |
| H3 | The pod on the dead node goes Terminating about 5 minutes after NotReady (default 300 s toleration). Its replacement stays Pending, because `DoNotSchedule` with `maxSkew: 1` leaves zone-c as an empty eligible domain. Capacity stays 2 of 3 until the node returns. | A replacement is Running on another node before the node returns. |
| H4 | The 2-minute RTO target in `docs/slo-rto-rpo.md` is met, because RTO is defined by success ratio and not by 3/3 replicas. Full replica restore (3/3) is a separate, slower measure and is reported separately. | RTO window start is greater than 120 s. |
| H5 | No alert pages. The degradation lasts under a minute against a `for: 5m` hold (`slo-rto-rpo.md` section 5). If confirmed this is a finding: a zone loss shorter than the alert floor is invisible. | HighErrorRate or any other alert fires. |
| H6 | Ledger: 0 duplicates (no retries exist). Lost responses are possible only for requests in flight at the kill. | A duplicate appears: stop and investigate the generator first. |

Error budget context: 99.5% over 30 days is 12,960 s of full-outage equivalent. One third of traffic
failing for about 50 s costs about 17 s, about 0.13% of the budget. The SLO is not at risk from this
scenario. The RTO target is what is being tested.

## Abort conditions
**Manual monitoring is required.** The checked-in script enforces startup and
control gates, but not the conditions below. An operator must monitor the client,
ledger, Supabase and host; press Ctrl-C when a condition is met. The script
restores the node on exit. See [the runbook](../runbooks/SC-01-zone-loss.md).
Abort if:
- any duplicate sale appears,
- more than 50% of requests fail for 90 s beyond the expected endpoint-removal window (more than
  150 s after the fault),
- Supabase becomes unreachable (not caused by this experiment),
- the host shows memory or disk pressure.

## Procedure
`RUN_ID=sc01a ./scripts/sc01-zone-loss.sh`. Timeline: 120 s steady state, fault, 480 s hold,
restore, 480 s recovery, plus 30 s margin. About 18.5 minutes. Outputs in
`measurements/results/<RUN_ID>/`: `events.log`, `timeline.log` (10 s samples of node, pods and
ready endpoints), `before.txt`, `after.txt`, `client.jsonl`.

## Measurement
- Client: `node measurements/scripts/windows.mjs measurements/results/<RUN_ID>`. 30 s windows keyed
  on request send time (completion time minus latency). RTO is the start of the first window from
  which every later window meets 99.5%. Resolution is 30 s.
- Ledger: same reconcile as `base2`, tag prefix `lg-<RUN_ID>-`.
- Detection: Alertmanager and Golden Signals screenshots at fault time and 8 minutes later.

## Result
### sc01a: invalid (2026-10-16)
The control failed before the fault. In the first 30 s window 4 of 149 requests succeeded, and
5,544 of 5,550 failed over the run, with the same ratio before, during and after the kill. The
load generator pod had been given IP 10.244.0.2 (the control plane's range) on a node whose
podCIDR is 10.244.1.0/24, so its cross-node traffic and DNS never returned. H1 to H6 were not
tested and these numbers are not a finding. The harness itself worked: fault at 09:43:07Z,
restore at 09:51:14Z, node Ready 4 s later. Evidence: `measurements/results/sc01a/`.
Underlying cause: under investigation (`netdiag.txt`).

### sc01b: invalid (2026-11-02)
The load generator exited at startup with "no LG-* products found" and produced no request data.
Cause: the test shop's trial expired on 2026-10-19 (grace ended 2026-10-24), so Tawira's
`is_account_usable()` returned false and row-level security hid every product from the load user
(`shop_admin`). The products were intact in the database (20 LG-* rows, none deleted). Not a
cluster, network or fault-injection problem. Fix: `target/tawira/seed.sql` now keeps the local
trial open (to 2027-11). Server-side logs from the run (`events.log`, `timeline.log`) are cluster
behaviour only and carry no measurement value.


### sc01c: interrupted before fault (2026-11-02)
The foreground runner exited with status 130 during steady-state control. No `CONTROL OK` or
`FAULT` event was recorded. Worker3 remained running. Evidence: `measurements/results/sc01c/`.

### sc01c2: invalid sale measurement (2026-11-02)
The supervised retry completed the worker kill/restore cycle. Its HTTP-only control passed
(613 responses, all HTTP 200), but ledger reconciliation found no tagged sales. The first
response body contains an application error: `process_sale` with the image's six arguments was
not found in the schema cache. The database's current function requires `_discount`; the
running image was older than that database contract. HTTP 200 did not mean a recorded sale.

The 5,550 requests included 5,472 HTTP 200 application responses and 78 transport failures.
The original HTTP-only calculation of 60 s RTO is **not a sale RTO**. It is preserved in
`measurements/results/sc01c2/http-only-windows.txt` solely to document the invalid analysis.
The fault was at 13:37:25Z; restore at 13:45:28Z; node Ready at 13:45:30Z with its IP unchanged.
`events.log`, `timeline.log`, `dashboard-run.png` and `alerts-range.json` are preserved in that
directory. No alert series was returned for the run window; application errors carried HTTP 200.

The generator now validates the serialized result and records `ok` and `saleId`. The control
gate requires HTTP 200 **and a sale UUID**, at least 90% of expected traffic, success at least
99.5%, p95 at most 1 s, and p99 at most 2 s. The analyzer rejects legacy HTTP-only rows.
A fresh image and a ledger-verified smoke test are required before the next fault.

### sc01c3: measured (2026-11-02, one local run)
Before this run the local image was rebuilt from Tawira commit `605e59d`, loaded into all kind
nodes, and rolled out to three replicas. The generator supplies a fresh request UUID per sale,
validates the response's sale UUID, and never retries. A 30 s smoke test recorded 150 validated
sales and 150 distinct ledger rows. Its initial latency exceeded the targets, so the full
pre-fault control was required: 642/642 sales, p95 820 ms, p99 1,755 ms. The control passed the
explicit gate described above before the fault. This uses a newer workload than `base2` and is
not a repeat measurement of that application version; the original recovery targets are unchanged.

| Measure | Observed |
|---|---|
| Requests sent | 5,550 |
| Validated sale successes / matching database rows | 5,480 / 5,480 |
| Clean failures | 70; 45 timeouts, 24 EHOSTUNREACH, 1 ECONNREFUSED |
| Acknowledged sales missing or mismatched / lost responses / duplicate tags | 0 / 0 / 0 |
| Failure send times relative to fault | 0 to 44 s; none after restoration |
| Success-ratio RTO | **60 s**, 30 s resolution; meets the 120 s target |
| Successful-sale latency p50 / p95 / p99 over the run | 154 / 541 / 939 ms |
| Ready endpoints | 3 before fault, 2 first sampled at +53 s, 3 first sampled at +500 s |
| Replacement while worker was down | Pending; first sampled at 14:54:17Z |
| Fault / restore / node Ready | 14:48:26Z / 14:56:31Z / 14:56:35Z |
| Node container IP | Unchanged, 172.21.0.3 |
| Alerts | No firing series. HighLatencyP99 was pending before the fault and last sampled pending at 14:49:41Z. |

The first two post-fault 30 s windows had 106/150 and 124/150 successful sales; all subsequent
qualifying windows were 100%. Service recovery preceded full replica restoration. These are
local observations, not AWS availability-zone recovery timings or a database-volume RPO test.

Evidence: `measurements/results/sc01c3/` contains `events.log`, `timeline.log`, `control.jsonl`,
`client.jsonl`, `windows.txt`, `ledger.json`, `reconcile.json`, `alerts-range.json`, and the
fixed-window `dashboard-run.png` (17:45:56–18:05:11 Africa/Nairobi). Image provenance is in
`measurements/results/image-refresh20261102.txt`. All nodes were Ready, all three Tawira replicas
were Running, and the load Job was Completed at the end.

## Hypothesis verdicts (`sc01c3`, one local run)
| ID | Verdict | Evidence |
|---|---|---|
| H1 | Not refuted | 70 failures, inside the predicted 67 to 100. Failure send times 0 to 44 s. Worst 30 s window 44/150 (29.3%), under one third. |
| H2 | Recorded | 45 timeouts at about 30,000 ms (the generator's 30 s timeout), 24 fast `EHOSTUNREACH`, 1 `ECONNREFUSED`. Both failure modes occur. |
| H3 | Not refuted | Original pod sampled Terminating and replacement Pending at +5 m 51 s. The scheduling mechanism is an inference; no scheduler trace was captured. Ready endpoints stayed at 2 until the +500 s sample, after restore. Node NotReady was first sampled at +53 s, so the 300 s toleration is confirmed only to sampling resolution. |
| H4 | Met | RTO 60 s against the 120 s target. Full 3/3 restore is separate: first sampled at +500 s, after the node returned. |
| H5 | No-firing prediction not refuted | No firing series. `HighLatencyP99` was already pending before the fault. This supports a coverage finding for this run, not a claim that all brief outages are invisible. |
| H6 | Not refuted | 0 duplicates, 0 lost responses, 0 acknowledged sales missing. |

Findings:
- **F1: degraded capacity was invisible.** Client failures ended by +44 s; two ready endpoints were sampled from +53 s until three were sampled at +500 s. No firing series covered this roughly 7.5-minute sampled capacity loss. The existing error-rate and latency rules do not directly measure replica redundancy. This is a rule-reading inference; review capacity coverage in `atlas-observability` before relying on it.
- **F2: capacity stayed at 2/3.** The replacement stayed Pending until the node returned. Strict `DoNotSchedule` spread with `maxSkew: 1` is the inferred cause; no scheduler trace isolated it. See ADR-0005 for the proposed comparison.
- **F3: pre-fault `HighLatencyP99` was pending.** Control p99 was 1,755 ms. The rule uses a 5-minute server histogram, while 1,755 ms is a client control percentile. Compare their time ranges and populations before attributing the pending state to the fault.

One run, local environment. These are observations, not availability-zone timings.
See the [postmortem](../postmortems/SC-01-zone-loss.md),
[detection finding](../findings/F-01-sale-detection-gap.md), and
[ADR-0005](../adr/ADR-0005-zone-loss-placement-and-eviction.md).

## Limits of this environment
Zones are node labels on one host (`slo-rto-rpo.md` section 6). The control plane is a single node
and is not part of the fault. The database is outside the cluster and unaffected.
The original environment forced the victim choice: `worker3` was the worker without a CoreDNS
replica. In the rebuilt cluster used for `sc01c3`, both CoreDNS pods are on the control plane;
`worker3` remains the fixed victim and preflight checks placement on every run. A real zone loss
can take DNS capacity with it, so a separate DNS-confounded experiment with
`ALLOW_DNS_CONFOUND=1` would need its own run ID and must not be mixed into this result.
Underlying cause: not diagnosed. The cluster was rebuilt before node-network diagnostics were
captured, so the suspected cause (Docker reassigning node container IPs after a host restart) is
unverified. The control gate and loadgen IP check in the script now detect this condition at the
start of a run.

### `gdsc01`: Game Day repeat (2026-11-08)

The 120-second control passed with 636 validated sales, p95 437 ms and p99
684 ms. Worker3 was killed at 09:05:19Z and restored at 09:13:24Z. It became
Ready at 09:13:27Z with its original IP. The 5 RPS run sent 5,550 requests;
5,465 validated sales matched 5,465 distinct ledger rows. There were 85 clean
transport failures, no acknowledged sales missing, lost responses, duplicate
tags or unmatched rows. Sale-success RTO was 60 s at 30 s resolution, within
the 120 s target. Failures were sent from 0 to 49 s after the fault; none were
sent after restoration. No alert-range export was captured for this run. This is a second
local observation, not an independent-zone availability result. Artifacts are
in `measurements/results/gdsc01/`.

### `sc01d`: ADR-0005 comparison (2026-11-08)

The taint-aware hard-spread overlay with 60-second not-ready/unreachable
tolerations produced a third Ready replica on worker2 at +126 s while worker3
was NotReady. Sale-success RTO was 90 s at 30 s resolution. The 5,550-request
run recorded 5,454 validated sales and 96 clean transport failures; all
validated sales matched unique ledger rows, with zero lost responses,
acknowledged mismatches or duplicates. All three predeclared acceptance
criteria passed. The replacement stayed on worker2 after worker3 returned, so
the overlay was rolled back and the baseline Deployment restored to 1/1/1.
This is one local comparison, not an independent-zone result. Details and the
pre-registered hypotheses are in [ADR-0005](../adr/ADR-0005-zone-loss-placement-and-eviction.md)
and `docs/evidence/review/2026-11-08-sc01d-hypotheses.md`; raw artifacts are in
`measurements/results/sc01d/`.
