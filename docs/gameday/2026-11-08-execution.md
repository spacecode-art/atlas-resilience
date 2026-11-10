# Game Day execution record — 2026-11-08

## Session

- Environment: dedicated local `kind-atlas-resilience`, Tawira test workload,
  local Supabase project and local Atlas observability stack.
- Participants: solo operator, acting sequentially as facilitator, operator,
  observer and recorder. No separate participants were present.
- Recording: no audio or video recording was made. This record and the machine
  artifacts are the session evidence.
- Scope: SC-01 worker loss, SC-02 local database outage, and synthetic SC-05/
  SC-06 tabletop rehearsals. No production endpoints, data, identities,
  credentials or notifications were used.
- Entry checks: local kind context; four nodes Ready; Tawira 3/3 Ready;
  worker3 had no CoreDNS pod; every pod IP matched its node podCIDR; local DB
  identity, persistent mount, migrations, test inventory, generator ConfigMap,
  Prometheus access and host resource floors passed `gdcheck`.

## Timeline (UTC)

| Time | Activity | Result / evidence |
|---|---|---|
| 09:00:59 | Read-only entry check | Passed; `gdcheck` metadata in command output, no fault injected. |
| 09:03:10–09:21:47 | SC-01 run `gdsc01` | Control passed; worker3 fault, restoration and full observation completed. See `measurements/results/gdsc01/`. |
| 09:45:30–09:46:07 | SC-02 check and smoke `gdcheck` / `gdsmk` | Check passed; 150/150 smoke sales reconciled. See `measurements/results/gdsmk/`. |
| 09:46:49–10:09:25 | SC-02 run `gdsc02` | Control passed; local Postgres stopped and restored; full recovery observation and load margin completed. See `measurements/results/gdsc02/`. |
| 10:11:53 | SC-05 / SC-06 `tabletop-20261108` | Both synthetic rehearsals passed. See `measurements/results/tabletop-20261108/`. |
| 10:12:10 | Closure check `gdclose` | Local DB healthy; four kind nodes Ready; Tawira 3/3; read-only preflight passed. |

## Measured outcomes

| Scenario | Target / observation | Verdict |
|---|---|---|
| SC-01 `gdsc01` | Sale-success RTO 60 s at 30 s resolution, against 120 s. 5,550 requests; 5,465 validated sales; 85 clean transport failures. 5,465 ledger rows matched distinct tags; 0 missing acknowledgements, lost responses, duplicates or unmatched rows. | RTO target met. Worker3 returned Ready with unchanged IP. This runner did not capture an alert-range export. |
| SC-02 `gdsc02` | 5 RPS for 1,350 s; 6,750 requests; 4,319 validated sales and 2,431 HTTP 200 application errors. 4,319 ledger rows and distinct tags; 0 lost responses, duplicate tags or mismatches. | 510 s fault-relative RTO and 30 s DB-ready-relative RTO, both 30 s resolution. DB-ready target met. No firing alert series was sampled. |
| SC-05 | Fictional principal identified; old fixture key denied; replacement allowed for expected action and denied for forbidden action. | Synthetic state-machine rehearsal passed; no live IAM/STS evidence. Simulated milestones 1/3/4 s, not wall-clock response measurements. |
| SC-06 | Synthetic token found without recording its value; untracked `.env` absent from `git archive`; mock old consumer denied and replacement accepted. | Local fixture rehearsal passed; Gitleaks was not run and no real secret was rotated. Simulated milestones 1/2/3 s, not wall-clock response measurements. |

The SC-02 control passed with 601 requests, 100% validated sales, p95 345 ms
and p99 461 ms. Twenty client failures were sent after the DB restore command,
while readiness was transitioning; later complete windows recovered. The first
complete DB-ready-relative window reached 95.33%, and the following window
reached 100%. The SC-01 control passed with 636 requests, 100% validated sales,
p95 437 ms and p99 684 ms.

## Closure and limits

All four kind nodes were Ready, Tawira had three Ready replicas, and the local
Postgres container was healthy at closure. The final read-only SC-02 preflight
passed. Alert evidence is sampled state only; no notification delivery was
tested. These results are local observations and do not establish independent
availability zones, production recovery, database volume-loss RPO, live IAM
revocation, real credential rotation, or Game Day video evidence.

See [the postmortem](../postmortems/2026-11-08-game-day.md) for findings and
actions.
