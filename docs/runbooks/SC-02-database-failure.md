# SC-02 prepared operator procedure

## Status and responsibilities
Prepared, not executed. Read the scenario before the session. Assign an
operator for the database and an observer for client outcomes and telemetry;
one person may hold both roles only while actively watching. This is a manual
procedure, not an unattended one-command harness.

## Preflight and control
1. Confirm `kubectl config current-context` is `kind-atlas-resilience`.
   Verify all pod CIDRs, three healthy replicas and no host pressure.
2. Set `DB` to the exact local Supabase Postgres container chosen from
   `docker ps`. Inspect its image, project labels and volume mounts. Require a
   local Supabase Postgres image, the expected local project and the seeded
   test-shop UUID. Do not infer the target from a remote URL or select the
   first arbitrary database container. Record its initial running/health state.
3. Record image digest, Tawira source commit and applied migration versions.
   Seed the local test shop, refresh both generator scripts, and verify auth
   and 20 visible LG-* products. Use the README's local-only credential flow.
4. Create a 5 RPS, 30 s load Job with a unique smoke ID. Require 150 `ok:true`
   results, `sales_ok=150`, and 150 distinct matching sale UUIDs in the DB.
5. Create the measurement Job from `load/job.yaml`, pinned to worker2, with
   `RPS=5`, `DURATION_S=1350`, and a new `RUN_ID=sc02a`. Keep the same environment
   secret and both script ConfigMap files. Never use `sc01-zone-loss.sh` to
   launch this scenario: it would kill a worker instead of the database.
6. Observe startup at 15 s and the full 120 s control. Apply the exact gate in
   the scenario; save its inputs and result. **No DB stop until it passes.**
   Mark `CONTROL OK` only after checking validated sale UUIDs and latency.

## Fault block for the same foreground shell
Run from the repo root only after that control has passed. Set the two inputs
explicitly; these commands do not create the load Job or automate its gate.

```bash
# DB and RUN_ID must already identify the verified local test DB and new run.
: "${DB:?select the local Supabase DB container}"
: "${RUN_ID:?set the measurement run ID}"
[[ "$DB" == supabase_db_* ]] || { echo 'Unexpected DB name'; exit 1; }
[[ "$RUN_ID" =~ ^sc02[a-z0-9]{1,12}$ ]] || { echo 'Unexpected run ID'; exit 1; }
OUT="measurements/results/$RUN_ID"
mkdir -p "$OUT" # create this directory before the control; never reuse old IDs
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$OUT/events.log"; }
restore_db() { docker start "$DB" >/dev/null; }
trap restore_db EXIT
trap 'exit 130' INT TERM
log "FAULT docker stop $DB"
if ! docker stop --time 30 "$DB" >/dev/null; then exit 1; fi
log 'DB_STOPPED; hold 480 seconds'
sleep 480
log "RESTORE docker start $DB"
restore_db || exit 1
ready=0
for attempt in $(seq 1 150); do
  if docker exec "$DB" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  log 'INVALID database not ready within 300 seconds'
  exit 1
fi
log 'DB_READY; recovery observation 600 seconds'
sleep 600
log 'RECOVERY_OBSERVATION_COMPLETE'
```

Use a dedicated shell/script so the EXIT trap stays installed until the fault
procedure ends. Ctrl-C aborts and restores the DB; verify actual readiness after
any abort. A daemon/host crash can defeat a shell trap: recover in another
terminal with `docker start "$DB"`, then verify DB and application readiness.
No `docker rm`, volume deletion, schema reset or production credentials belong
in this procedure. Keep control/events in the same directory and capture
Postgres shutdown/start logs alongside the client timeline.

## Observation and closeout
Save client logs even if the Job fails. Note DB health every 10 s and replica
restart counts before/after. Inspect Prometheus series and alert states every
15 s, and retain their query range; absence, zero rate, non-200 and HTTP 200
application errors need different interpretations. Do not send notification
test messages as part of this preparation.

After the Job completes, reconcile **all** tags and returned UUIDs, not only
HTTP statuses. Confirm Postgres, Auth and PostgREST work, three Tawira replicas
remain healthy, and no application rollout/restart was needed. Save the
summary, ledger, graph and raw alerts; no graph alone proves recovery.
Run the analyzer for fault-relative RTO, then derive and report the offset from
the logged `DB_READY` anchor, including 30 s resolution and observation limits.
If recovery or evidence is incomplete, record invalid/unmeasured rather than a
successful RTO. Evaluate H1–H6 and write the postmortem without altering targets.
