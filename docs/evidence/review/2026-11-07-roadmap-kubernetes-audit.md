# Roadmap and Kubernetes audit — 2026-11-07

The Phase 5 roadmap calls for local scenario designs, a Chaos Mesh exercise,
Game Day evidence and measured RTO/RPO. This audit records the live checks used
to verify the current kind environment. It is a readiness observation, not a
new fault experiment.

## Commands and observations

| Command/check | Observation |
|---|---|
| `pdftotext Atlas-DevSecOps-Path.md.pdf` and Phase 5 review | Phase 5 requires failure designs, a local chaos exercise, a recorded Game Day/postmortem and local/burst RTO/RPO measurement. |
| `kubectl --context kind-atlas-resilience get nodes -L topology.kubernetes.io/zone -o wide` | Control plane Ready; workers Ready and labeled `zone-a`, `zone-b`, `zone-c`; Kubernetes v1.37.0; containerd 2.3.4. |
| `kubectl ... -n tawira get deployment tawira` | Desired 3, Ready 3, image `tawira:chaos-local`. |
| `kubectl ... -n tawira get pods -o wide` | Three Tawira pods Running, one on each worker; completed `loadgen-sc02smk7` pod on worker2. |
| `kubectl ... -n tawira get svc` | `tawira` ClusterIP Service exposes port 3000. |
| `bash scripts/check-pod-cidrs.sh` | `OK: every pod IP is inside its node's podCIDR`. |
| `kubectl ... -n chaos-mesh get pods -l app.kubernetes.io/component=chaos-dns-server` | Chaos DNS Server `1/1 Running`. |
| `kubectl ... -n tawira get dnschaos --ignore-not-found` | No active DNSChaos object. No DNS fault was injected. |
| `kubectl ... -n tawira get jobs` | `loadgen-sc02smk7` has `SUCCEEDED=1`, no active or failed Job. |
| `node measurements/scripts/reconcile.mjs measurements/results/sc02smk7/client.jsonl measurements/results/sc02smk7/ledger.json` | 150 sent, 150 acknowledged, 150 database rows, 0 mismatches, 0 lost responses, 0 duplicates. |

The initial audit used two unquoted zsh `custom-columns` arguments; zsh tried
to expand the brackets before `kubectl` ran. Those queries were repeated with
quoted arguments and passed. This is a shell invocation issue, not a cluster
failure, and the corrected command forms are the ones recorded above.

## Coverage boundary

This audit checks Kubernetes state and the measurement control. It does not
prove worker-loss recovery beyond the preserved SC-01 run, database outage
recovery, DNS fault behavior, certificate expiry, Game Day response or alert
MTTD. Those require separate attended experiments with their own evidence.
