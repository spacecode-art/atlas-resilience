# ADR-0005 comparison pre-registration — 2026-11-08

Run ID: `sc01d`. This record was written before applying
`target/tawira/zone-loss-recovery-patch.yaml`.

## Baseline and entry state

The unchanged Deployment is `target/tawira/tawira.yaml`, with hard
`DoNotSchedule` zone spread, `maxSkew: 1`, `matchLabelKeys: [pod-template-hash]`
and no explicit tolerations. The 2026-11-08 baseline `gdsc01` recovered
validated sales in 60 seconds. Its sampled timeline showed two Ready endpoints
from +53 seconds until worker3 returned; the replacement remained Pending
while the original pod was Terminating.

Before the comparison: all three workers are Ready in zones a/b/c, Tawira has
three Ready replicas at 1/1/1, no Tawira pod is pending, and the victim
`atlas-resilience-worker3` has no CoreDNS pod. The worker container is running
with IP `172.21.0.3`. Worker nodes have no taints; the control-plane
NoSchedule taint is unchanged. The running Deployment has no explicit pod
tolerations.

## Predictions and acceptance criteria

Use the existing 5 RPS SC-01 load and unchanged control gate/targets.

1. A replacement Ready replica appears on a surviving worker within 180 s of
   the worker fault.
2. Sale-success RTO is at most 120 s at 30 s window resolution.
3. No acknowledged sale is missing or mismatched, and there are no duplicate
   ledger tags.
4. Record node taints, Pending reasons, endpoint count, pod placement, worker
   readiness/IP and alert evidence. Preserve failures and invalid evidence.

Reject the overlay if any of criteria 1–3 fails. A successful local result
would not establish independent-zone resilience or apply to stateful workloads.

## Restoration

After the run, reapply the baseline `target/tawira/tawira.yaml`, wait for the
Deployment rollout, confirm the explicit tolerations are gone and verify
three Ready replicas at 1/1/1. Preserve both the candidate and final live
Deployment evidence with the run.

## Measured result

`sc01d` passed all three criteria. The replacement pod became Ready on worker2
at +126 s; sale-success RTO was 90 s at 30 s resolution. The 5,550-request run
had 5,454 validated sales and 96 clean transport failures. Reconciliation
found 5,454 distinct database rows, no missing acknowledgements, no lost
responses, no duplicate tags and no unmatched rows. Worker3 returned Ready
with unchanged IP. The overlay's replacement stayed on worker2 after worker3
returned; the baseline was then restored and the rollout returned the
Deployment to 1/1/1 with no explicit tolerations. Full logs and analyzers are
in `measurements/results/sc01d/`.
