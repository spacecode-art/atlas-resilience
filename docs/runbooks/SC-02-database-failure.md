# SC-02: database outage procedure

## Status and responsibilities
Prepared and fixture-tested on 2026-11-02; **no live SC-02 fault has run**.
Read the [scenario](../scenarios/SC-02-database-failure.md) first. Assign an
operator for the DB and an observer for client outcomes and telemetry; one
person may hold both roles while actively watching.

The runner has explicit `--check`, `--smoke` and `--run` modes. Only `--run`
stops the selected DB. It uses the local Docker socket and the explicit
`kind-atlas-resilience` context. It never removes a container/volume or restarts
Tawira. Fixture tests verify refusal and cleanup paths; they cannot establish
that the local stack will recover.

## Prepare the local session
1. Start the local Supabase and observability stacks. Select the exact local
   Postgres container from `docker ps`. Inspect its image, persistent mount and
   `com.supabase.cli.project` label; set `DB` and `LOCAL_PROJECT` to that pair.
   Do not copy hosted project identifiers or production credentials into evidence.
2. Follow the README deployment flow. Require three Ready application replicas,
   correct per-node pod CIDRs and a working Prometheus API at localhost:9090.
   Record the Tawira source commit used to build the image. The runner records
   actual image IDs, DB migration versions and hashes of its measurement code.
3. Apply the seed to that verified local DB and refresh **both** generator files:

```bash
: "${DB:?select the verified local Supabase DB container}"
: "${LOCAL_PROJECT:?set its expected local project label}"
docker --host unix:///var/run/docker.sock exec -i "$DB" \
  psql -X -U postgres -v ON_ERROR_STOP=1 < target/tawira/seed.sql
kubectl --context kind-atlas-resilience -n tawira create configmap loadgen-script \
  --from-file=loadgen.mjs=load/loadgen.mjs \
  --from-file=sale-result.mjs=load/sale-result.mjs \
  --dry-run=client -o yaml | kubectl --context kind-atlas-resilience -n tawira apply -f -
```

Export `DB` and `LOCAL_PROJECT` in the foreground shell. The load secret must
point at the local bridge/API port for this DB project and the Tawira Service.
Keep port forwards running. Do not use `sc01-zone-loss.sh` for this scenario.

## Check, smoke, then fault
Use new IDs; an existing evidence directory is refused without changing it.

```bash
RUN_ID=sc02check node scripts/sc02-db-loss.mjs --check
RUN_ID=sc02smoke1 node scripts/sc02-db-loss.mjs --smoke
```

`--check` is read-only: no load Job, writes or fault. It verifies DB/project/API
identity, migrations, inventory, three Ready pods sharing one image, no active
Jobs, pod CIDRs, ConfigMap equality, Prometheus access and host resource floors
(1 GiB MemAvailable, 2 GiB free disk). It does not prove authenticated sale health.

`--smoke` creates a 30 s Job at 5 RPS, pinned to worker2. It must finish with
150 acknowledged sales and matching ledger UUIDs, with no duplicates or extra
DB tags. It makes real test-shop sales but never stops the DB. Inspect its
`client.jsonl`, `reconcile.json` and final `DONE` event. Failed runs remain as
invalid evidence; correct the cause and use a new ID.

Only after the smoke passes, during an explicitly scheduled fault session:

```bash
SMOKE_DIR=measurements/results/sc02smoke1 RUN_ID=sc02a \
  node scripts/sc02-db-loss.mjs --run
```

The fault mode verifies that the smoke is less than one hour old and uses the
same DB container, migrations, app image IDs, generator and runner/analyzer
hashes. It rechecks the smoke ledger. It then creates a 1,350 s Job (6,750
requests), observes startup and the 120 s control, and applies the declared
success/latency/volume gate. **No DB stop until `CONTROL OK`.**

The runner records `FAULT`, stops the DB with a 30 s shutdown allowance, records
`DB_STOPPED`, holds it down for 480 s, starts it, polls `pg_isready` for up to
300 s, records `DB_READY` and observes recovery for 600 s. If overhead consumes
the load margin, the evidence is rejected rather than reporting a shorter
recovery observation. Keep watching the terminal and dashboard throughout.

## Abort and restoration
The runner samples resource availability, Prometheus alert state, DB running
state and pod readiness/restarts about every 10 s. During control and recovery
it checks completed acknowledgements against the ledger and rejects duplicate
tags. Observation failure, resource-floor violation, a ledger violation, Job
failure or Ctrl-C aborts. Client failures during the planned DB stop are
expected; SC-01's >50% failure abort does not apply.

The operator must also abort for unexpected non-test data, a wrong target,
independent application/cluster failure, or unanticipated host pressure. Pod
restarts are recorded for interpretation; a restart alone does not trigger an
automatic abort. This requires an attended session.

After a stop attempt, cleanup attempts DB start and readiness even if stop,
hold, event storage or initial restore failed, or SIGINT/SIGTERM cancelled the run. The owned
load Job is removed on failure and available client logs are saved. Cleanup
errors are printed; they do not imply recovery. SIGKILL, a host/daemon crash or
loss of the process can defeat cleanup. In another terminal, recover manually:

```bash
docker --host unix:///var/run/docker.sock start "$DB"
docker --host unix:///var/run/docker.sock exec "$DB" pg_isready -U postgres
```

Then verify authenticated reads and a validated sale, three Ready replicas and
observability. Never remove the volume or reset the schema to “recover” this
experiment. Save DB shutdown/start logs locally and review them for sensitive
content before committing.

## Evidence and closeout
Each new `measurements/results/<RUN_ID>/` contains:

| Artifact | Purpose |
|---|---|
| `run.json`, `job.json` | Timings, identities, migration/code hashes and exact load configuration |
| `events.log`, `timeline.jsonl` | Fault/readiness anchors, sampled DB/pod/resource/alert state |
| `control.jsonl`, `control-result.json` | Inputs and decision before fault injection |
| `client.jsonl` | Canonical complete request log and final summary |
| `ledger.json`, `reconcile.json` | Every run tag and sale UUID, acknowledgement/duplicate/lost-response accounting |
| `windows.txt` | Fault-relative and independently bucketed DB-ready-relative recovery |

`live-client.jsonl` and `monitor-ledger.json` are overwritten observation
snapshots, not the canonical result. The partial client snapshot is gitignored.
A failed run may have only some artifacts; `ABORT` disqualifies recovery analysis.

Reproduce the final checks without Docker:

```bash
node measurements/scripts/reconcile.mjs measurements/results/sc02a/client.jsonl \
  measurements/results/sc02a/ledger.json
node measurements/scripts/windows.mjs measurements/results/sc02a
```

The analyzer requires a complete, consistent final summary, contiguous request
indices and adequate traffic in every full post-anchor window. Partial tails
cannot establish recovery. Both grids use 30 s resolution; subtracting the two
reported rounded RTOs is not a DB-ready calculation. “Not recovered” is a valid
measurement outcome; a successful analyzer exit alone does not satisfy H3.

Capture a dashboard over the fixed UTC run window and export the relevant
Prometheus query ranges, including pending/firing state and missing/zero-rate
series. The runner's sampled `/alerts` history is not notification-delivery
proof and may miss brief states between samples. Record app restarts, manual
interventions and any incomplete evidence. Verify DB/Auth/PostgREST and test
sales after the run, evaluate H1–H6 against unchanged targets, and write the
postmortem. No notifications are sent by this procedure.
