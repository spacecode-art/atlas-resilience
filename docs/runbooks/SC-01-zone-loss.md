# SC-01 operator runbook

## Scope and entry conditions
Local `kind-atlas-resilience` only; victim worker3, load on worker2 by default.
Read the scenario and F-01 first. No alert currently covers the observed
connection failures. One operator watches client outcomes, cluster state,
Supabase and host resources throughout the run; do not start it unattended.

Verify the trial seed, matching image/database versions, 20 visible test
products, 150 validated smoke sales and 150 unique matching database rows.
Refresh both load script files in the ConfigMap as documented in the README.
Run `scripts/check-pod-cidrs.sh`, confirm three healthy workers, three Tawira
replicas spread 1/1/1, and check CoreDNS placement. Use a new run ID.

## Execute and observe

```bash
RUN_ID=sc01repeat1 ./scripts/sc01-zone-loss.sh
```

Use an unused ID and record the exact manifest/image before the run. `sc01d`
is reserved for the ADR-0005 comparison; use a different ID for an unchanged
baseline repeat. The script automatically checks startup at 15 s, validates
the pre-fault control, restores the node on EXIT/INT/TERM, checks node readiness
and IP, and saves client logs. It does not detect duplicates, monitor host
pressure, or enforce the sustained-failure threshold on its own. `sc01c3` had
an additional session-local supervisor; that is historical evidence, not a
checked-in watchdog feature.

In another terminal, observe without changing the workload:

```bash
kubectl -n tawira logs -f job/loadgen
kubectl -n tawira get pods -l app=tawira -o wide --watch
```

Use the documented tag prefix to query the ledger for duplicates throughout
the run. Watch the Golden Signals dashboard, `free -h`, `df -h` and Supabase
health. Timed-out requests finish roughly 30 s after send; compare send times
when deciding whether the failure period exceeds its threshold.

## Manual abort
Press Ctrl-C if any duplicate sale appears, if more than half of requests
continue failing for 90 s beyond the expected endpoint-removal period (after
150 s from fault), if Supabase becomes unreachable independently of the fault,
or if the host shows memory/disk pressure. Preserve the reason and timestamp.
The script restores the worker on exit; verify it rather than assuming it.
If the terminal/session disappeared, recover from a separate terminal:

```bash
docker start atlas-resilience-worker3
kubectl --context kind-atlas-resilience wait --for=condition=Ready \
  node/atlas-resilience-worker3 --timeout=300s
kubectl --context kind-atlas-resilience -n tawira get pods -o wide
```

Failed node readiness or changed node IP marks a run invalid. Preserve logs;
repair/rebuild the local cluster and repeat under a new ID. Never overwrite
old evidence or derive a trusted RTO from the failed recovery.

## Close the run
Confirm the Job completed, all expected request rows and the summary are
present, all nodes Ready, three replicas Running and a healthy distribution.
Run `node measurements/scripts/windows.mjs measurements/results/<RUN_ID>`.
Reconcile each validated sale UUID and tag against the database, including
failed/ambiguous requests. Capture alert state history and a dashboard over
fixed start/end timestamps; distinguish pending from firing. Record whether
the original success and latency targets were met; never revise them to fit.

## ADR-0005 comparison preparation (not executed)
Select only the Deployment before patching the multi-document manifest:

```bash
python3 - <<'PYCODE' > /tmp/atlas-tawira-deployment.yaml
import yaml
with open('target/tawira/tawira.yaml') as f:
    deployment = next(d for d in yaml.safe_load_all(f) if d['kind'] == 'Deployment')
print(yaml.safe_dump(deployment))
PYCODE
kubectl patch --local -f /tmp/atlas-tawira-deployment.yaml \
  --patch-file=target/tawira/zone-loss-recovery-patch.yaml -o yaml \
  > /tmp/atlas-tawira-recovery-candidate.yaml
```

Review the candidate and write the comparison hypotheses before any apply.
Require spare resources and no Pending pods. Deployment/application of this
candidate and a new worker fault are separate future work. For rollback,
remove the overlay's explicit tolerations and taint policy, restore the default
manifest, roll out, and verify three healthy zones; pod spread is not a
background rebalancer.
