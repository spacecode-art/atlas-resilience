# ADR-0005: Zone-loss placement and eviction

## Status
Accepted for a controlled comparison on 2026-11-02. The overlay is prepared,
not deployed or measured. The default Deployment preserves the `sc01c3` policy.

## Context
One local `sc01c3` run recovered successful sales in 60 s, but the third replica
was unavailable until the worker returned. A replacement was first sampled
Pending at 14:54:17Z; three ready endpoints returned at 14:56:46Z (+500 s).
This is a capacity-recovery finding, distinct from the 120 s sale-success target.
The default configuration uses hard zone spread and implicit eviction tolerations.

## Decision
Keep `target/tawira/tawira.yaml` as the measured placement baseline. Prepare
`target/tawira/zone-loss-recovery-patch.yaml` for a separate `sc01d` comparison:

- Retain `DoNotSchedule`, `maxSkew: 1` and per-ReplicaSet matching for healthy spread.
- Set `nodeTaintsPolicy: Honor` so untolerated node taints affect eligible domains.
- Set the not-ready and unreachable `NoExecute` tolerations to 60 seconds each.
- Leave `minDomains` unset. Never claim this restores capacity until measured.

The intended tradeoff is earlier stateless replacement and more pod churn during
short network interruptions. There are no attached application volumes in this
Deployment; this decision is not a policy for stateful workloads.

## Alternatives

| Policy | Reason |
|---|---|
| Keep implicit 300 s tolerations and taint-ignoring spread | Preserved baseline; observed delayed replacement and a Pending pod. |
| Only shorten tolerations | Creates a replacement earlier but does not address the eligible-domain constraint. |
| `ScheduleAnyway` plus shorter tolerations | Allows less balanced placement even while healthy; held in reserve. |
| Add `minDomains: 3` | Not a recovery shortcut: with fewer eligible domains the global minimum becomes zero, which can prevent a 2/1 spread. |
| Taint-aware hard spread plus 60 s eviction | Chosen comparison; retains the hard healthy-spread rule while accounting for failed-node taints. |

## Comparison procedure and acceptance criteria
Before applying the overlay, write `sc01d` hypotheses and capture node taints,
actual pod tolerations, eligible zones, three Ready workers, and 1/1/1 placement.
Require the same 5 RPS validated-sale control and targets as `sc01c3`.

The patch targets only the Deployment document. Follow the document-selection
and local rendering commands in the [SC-01 runbook](../runbooks/SC-01-zone-loss.md),
then review the rendered candidate. Do not patch the Namespace/Service documents
or apply the candidate before writing the comparison hypotheses.

Prediction: under the same eight-minute worker fault, a third Ready replica will
appear on a surviving worker within 180 s, while sale RTO remains at most 120 s,
with no missing acknowledged sales or duplicates. Reject the change if either
criterion fails. Capture Pending reasons and node taints to test the proposed
mechanism. The prediction is not a result.

After the comparison, restore the default Deployment, roll it out, verify the
old explicit tolerations are removed (reset pod-template tolerations to `null`
when rolling back), and verify 1/1/1 placement. Kubernetes does not automatically
rebalance existing replicas just because a failed zone returns.

## Sources and limits
The scheduling explanation is an inference from this manifest and the observed
Pending pod; the run did not capture a scheduler trace.
[Kubernetes topology spread](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
defines eligible domains, taint policy and `minDomains`.
[Kubernetes tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
documents the implicit 300-second tolerations. Reviewed 2026-11-02.
All domains here are labels on one host, not independent availability zones.
