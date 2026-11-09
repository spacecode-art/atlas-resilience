#!/usr/bin/env bash
# SC-02 companion: backup-and-restore drill for the database VOLUME-loss case.
# The real DB volume is never touched. It dumps the live DB, lets you generate
# acknowledged sales AFTER the dump, then restores the dump into a throwaway
# container built from the same image and compares. Attended.
set -euo pipefail

RUN_ID="${RUN_ID:?set RUN_ID, e.g. RUN_ID=rpo1}"
DB="${DB:?set DB to the verified local Supabase Postgres container}"
LOCAL_PROJECT="${LOCAL_PROJECT:?set LOCAL_PROJECT to that container project label}"
die() { echo "ABORT: $*" >&2; exit 1; }
[[ "$RUN_ID" =~ ^[a-z0-9]{1,16}$ ]] || die "RUN_ID must match [a-z0-9]{1,16}"

d() { docker --host unix:///var/run/docker.sock "$@"; }
OUT="measurements/results/${RUN_ID}"
SCRATCH="atlas-restore-${RUN_ID}"
[[ ! -e "$OUT" ]] || die "$OUT exists; use a new RUN_ID"
[[ "$(d inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" == true ]] || die "DB is not running"
[[ "$(d inspect -f '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB")" == "$LOCAL_PROJECT" ]] || die "DB project label does not match LOCAL_PROJECT"
IMAGE="$(d inspect -f '{{.Config.Image}}' "$DB")"
[[ "$IMAGE" =~ ^(public\.ecr\.aws/supabase/postgres|supabase/postgres)(:|@) ]] || die "selected DB is not a Supabase Postgres image"

mkdir -p "$OUT"
q() { d exec "$1" psql -X -qAt -U postgres -c "$2"; }
snap="select count(*)||'|'||coalesce(max(created_at)::text,'') from public.sales"
cleanup() { d rm -f "$SCRATCH" >/dev/null 2>&1 || true; }  # removes only this drill's scratch container
trap cleanup EXIT
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUT/events.log"; }

# 1. Backup of the live database (public schema).
AT_BACKUP="$(q "$DB" "$snap")"
BACKUP_EPOCH="$(date +%s)"
d exec "$DB" pg_dump -U postgres -Fc -n public --no-owner --no-privileges postgres > "$OUT/backup.dump"
log "BACKUP rows|max_created_at=$AT_BACKUP bytes=$(wc -c < "$OUT/backup.dump")"

# 2. Acknowledged sales accumulate after the backup (operator step, existing tested harness).
echo
echo "Generate sales AFTER the backup, in another terminal (port-forward must be running):"
echo "  RUN_ID=${RUN_ID}load node scripts/sc02-db-loss.mjs --smoke"
read -r -p "Press Enter when that run has finished and reconciled... " _

# 3. Simulated volume loss: record what the live DB holds, then recover only from the backup.
AT_LOSS="$(q "$DB" "$snap")"
LOSS_EPOCH="$(date +%s)"
[[ "${AT_LOSS%%|*}" != "${AT_BACKUP%%|*}" ]] || die "no sales were recorded after the backup; the result would prove nothing"
log "SIMULATED_VOLUME_LOSS rows|max_created_at=$AT_LOSS (real volume untouched)"
START="$(date +%s)"
d run -d --name "$SCRATCH" -e POSTGRES_PASSWORD=scratch "$IMAGE" >/dev/null
# The image restarts Postgres once after init; wait for the second "ready" line.
until [[ "$(d logs "$SCRATCH" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ]]; do
  sleep 2
  (( $(date +%s) - START < 180 )) || die "scratch database not ready after 180 s"
done
d exec -i "$SCRATCH" pg_restore -U postgres -d postgres --no-owner --no-privileges < "$OUT/backup.dump" > "$OUT/restore.log" 2>&1 || true
AFTER_RESTORE="$(q "$SCRATCH" "$snap")" || die "restore produced no public.sales; see $OUT/restore.log"
END="$(date +%s)"
log "RESTORED rows|max_created_at=$AFTER_RESTORE restore_errors=$(grep -c 'error:' "$OUT/restore.log" || true)"

# 4. Compare.
IFS='|' read -r N_LOSS M_LOSS <<<"$AT_LOSS"
IFS='|' read -r N_REST M_REST <<<"$AFTER_RESTORE"
WINDOW="$(q "$SCRATCH" "select round(extract(epoch from ('${M_LOSS}'::timestamptz - '${M_REST}'::timestamptz))::numeric,1)")"
cat > "$OUT/result.json" <<EOF
{
  "run": "$RUN_ID",
  "image": "$IMAGE",
  "rows_at_backup": "${AT_BACKUP%%|*}",
  "rows_at_simulated_loss": $N_LOSS,
  "rows_after_restore": $N_REST,
  "acknowledged_rows_lost": $((N_LOSS - N_REST)),
  "exposure_since_backup_s": $((LOSS_EPOCH - BACKUP_EPOCH)),
  "newest_sale_gap_s": $WINDOW,
  "restore_s": $((END - START)),
  "restore_errors": $(grep -c 'error:' "$OUT/restore.log" || true)
}
EOF
cat "$OUT/result.json"
log "DONE; scratch container removed on exit; real volume never modified"