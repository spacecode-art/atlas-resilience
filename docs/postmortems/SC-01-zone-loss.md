# SC-01 postmortem: sale recovery preceded replica and alert recovery

## Status and impact
Recorded 2026-11-02 after one valid local run (`sc01c3`). No production traffic
or database was targeted. All three zones share a single host. Of 5,550 sale
attempts, 5,480 were acknowledged with sale UUIDs and matched the ledger; 70
were clean transport failures. Missing acknowledged sales, lost responses and
duplicate tags were all zero. Successful-sale p50/p95/p99: 154/541/939 ms.
Sale-success RTO was 60 s at 30 s resolution, against a 120 s target.

## Timeline (UTC)

| Time | Observation |
|---|---|
| 14:46:16 | Load started at 5 RPS. |
| 14:48:26 | Control passed: 642/642 validated sales, p95 820 ms, p99 1,755 ms; worker3 killed. |
| +0 to +44 s | Requests that later failed were sent; 45 timeouts, 24 EHOSTUNREACH, 1 ECONNREFUSED. |
| 14:49:19 | First sampled two ready endpoints (+53 s). |
| +60 s window | First window from which all later qualifying windows met success SLO. |
| 14:54:17 | Replacement first sampled Pending while old pod was Terminating. |
| 14:56:31 | Worker container restarted. |
| 14:56:35 | Node Ready, node IP unchanged. |
| 14:56:46 | First sampled three ready endpoints (+500 s). |
| 15:04:51 | Recovery observation finished; Job Completed; all nodes Ready and replicas Running. |

## Detection
No firing alert series was recorded. A pre-existing HighLatencyP99 pending
series cleared during the run. The server 5xx panel did not represent failed
client connections. [F-01](../findings/F-01-sale-detection-gap.md) records this
coverage gap, proposed remedies and evidence needed to close it. Slack delivery
was not exercised. Node loss, client impairment and alert hold duration must
not be treated as interchangeable measurements.

## Contributing factors and invalid attempts

- `sc01a`: load pod IP outside its node podCIDR; control already failed. The
  suspected Docker/host-restart cause was never isolated.
- `sc01a2`: startup produced no request measurement. Its log contains the empty
  product-list error; do not assign a new cause without preserved diagnostics.
- `sc01b`: expired test-shop trial hid products through row-level security.
- `sc01c`: runner interrupted in control, no fault event.
- `sc01c2`: old image called a stale RPC signature. HTTP-only success checking
  accepted serialized application errors. Ledger reconciliation exposed zero
  sales, so this is not a sale RTO result.

The harness originally lacked an effective application-success gate. This was
a tooling gap, not an operator fault. The seed now extends the local trial,
the image was refreshed, and the generator validates sale UUIDs. The analyzer
rejects empty/legacy or explicitly unverified recovery data.

The Pending replacement is consistent with hard topology spread including the
failed domain and the default eviction wait; no scheduler trace was recorded.
[ADR-0005](../adr/ADR-0005-zone-loss-placement-and-eviction.md) prepares a separate
comparison and preserves the observed baseline.

## Actions and ownership

| ID | Action | State / owner / verification |
|---|---|---|
| A1 | Seed keeps the local trial open | Done; resilience seed, authenticated product check and 150-sale smoke. |
| A2 | Validate sale acknowledgement and reconcile every measured run | Done; resilience generator/analyzer, 5,480 matching sale UUIDs. |
| A3 | Make failed node readiness and changed node IP explicit invalid exits | Implemented after `sc01c3`; tested with command stubs, no new fault claimed. |
| A4 | Improve placement and eviction | ADR-0005 comparison prepared; not deployed or validated. |
| A5 | Detect failed sales outside the server process | F-01 open in observability; tests and before/after drill required before closure. |
| A6 | Name manual abort responsibilities | SC-01 runbook; checked-in script has no database/host-pressure watchdog. |
| A7 | Investigate database recovery and detection | SC-02 prepared, not run; no conclusion yet. |

## Lessons and limits
A green HTTP status is not necessarily a recorded business operation. Restored
service and restored replica count have different recovery times. Retaining
invalid evidence prevented those results being mistaken for availability or
RPO claims. The valid run used a newer image than `base2`; one run does not
establish production reliability, database-volume durability or retry safety.

Evidence: `measurements/results/sc01c3/`, preceding run directories and
`measurements/results/image-refresh20261102.txt`.
