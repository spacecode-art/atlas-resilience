#!/usr/bin/env bash
# SC-03: service-name DNS failure for the load generator only.
# Chaos Mesh can express this in-cluster fault, so this is a small attended
# runner rather than a second injector. The database and Tawira replicas stay up.
set -euo pipefail

CONTEXT="kind-atlas-resilience"
NS="tawira"
CHAOS_NAME="sc03-${RUN_ID}"
LOADGEN_NODE="${LOADGEN_NODE:-atlas-resilience-worker2}"
RUN_ID="${RUN_ID:?set RUN_ID, e.g. RUN_ID=sc03a}"
DB="${DB:?set DB to the verified local Supabase Postgres container}"
LOCAL_PROJECT="${LOCAL_PROJECT:?set LOCAL_PROJECT to that container project label}"
MODE="${1:-}"
RPS="${RPS:-5}"
PRE_S="${PRE_S:-120}"
FAULT_S="${FAULT_S:-60}"
POST_S="${POST_S:-180}"

die() { echo "ABORT: $*" >&2; exit 1; }
[[ "$MODE" == "--check" || "$MODE" == "--run" ]] || die "usage: DB=... LOCAL_PROJECT=... RUN_ID=... $0 --check|--run"
[[ "$RUN_ID" =~ ^[a-z0-9]{1,16}$ ]] || die "RUN_ID must match [a-z0-9]{1,16}"
for v in RPS PRE_S FAULT_S POST_S; do [[ "${!v}" =~ ^[0-9]+$ ]] || die "$v must be an integer"; done
(( RPS > 0 && PRE_S >= 60 && FAULT_S >= 30 && POST_S >= 60 )) || die "invalid phase duration"

k() { kubectl --context "$CONTEXT" --request-timeout=10s "$@"; }
d() { docker --host unix:///var/run/docker.sock "$@"; }
OUT="measurements/results/${RUN_ID}"
JOB="loadgen-${RUN_ID}"
JOB_CREATED=0
FAULT_ACTIVE=0

preflight() {
  [[ "$(k config current-context)" == "$CONTEXT" ]] || die "kubectl context is not $CONTEXT"
  [[ "$(d inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" == true ]] || die "DB is not running"
  PROJECT="$(d inspect -f '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB")"
  [[ "$PROJECT" == "$LOCAL_PROJECT" ]] || die "DB project label does not match LOCAL_PROJECT"
  IMAGE="$(d inspect -f '{{.Config.Image}}' "$DB")"
  [[ "$IMAGE" =~ ^(public\.ecr\.aws/supabase/postgres|supabase/postgres)(:|@) ]] || die "selected DB is not a Supabase Postgres image"
  [[ "$(d exec "$DB" psql -X -qAt -U postgres -c "select count(*) from public.products where shop_id='d841607b-9f0e-447b-998b-efec2e6d89e0'::uuid and sku like 'LG-%' and not is_deleted;")" == 20 ]] || die "expected 20 seeded LG-* products"
  [[ "$(k -n "$NS" get deploy tawira -o jsonpath='{.status.readyReplicas}')" == 3 ]] || die "Tawira is not 3/3 Ready"
  k -n "$NS" get secret loadgen-env >/dev/null || die "loadgen-env Secret missing"
  for file in loadgen.mjs sale-result.mjs; do
    path="${file//./\\.}"
    local_hash="$(sha256sum "load/$file" | awk '{print $1}')"
    live_hash="$(k -n "$NS" get configmap loadgen-script -o "jsonpath={.data.$path}" | sha256sum | awk '{print $1}')"
    [[ "$live_hash" == "$local_hash" ]] || die "ConfigMap $file differs from local code"
  done
  k -n chaos-mesh wait --for=condition=Ready pod -l app.kubernetes.io/component=chaos-dns-server --timeout=30s >/dev/null || die "Chaos DNS Server is not Ready"
  [[ -z "$(k -n "$NS" get dnschaos -o name)" ]] || die "an existing DNSChaos experiment is active"
  active="$(k -n "$NS" get jobs -o json | jq -r '.items[] | select(.status.active > 0) | .metadata.name')"
  [[ -z "$active" ]] || die "another load Job is active: $active"
  CONTEXT="$CONTEXT" bash scripts/check-pod-cidrs.sh >/dev/null
}

if [[ "$MODE" == --check ]]; then
  preflight
  echo "SC-03 preflight passed: DNS injector ready, no active experiment, local code and cluster healthy"
  exit 0
fi

preflight
mkdir -p measurements/results
mkdir "$OUT" || die "$OUT already exists; choose a new RUN_ID"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$OUT/events.log"; }
cleanup() {
  status=$?
  trap - EXIT
  if ((FAULT_ACTIVE)); then
    kubectl --context "$CONTEXT" -n "$NS" delete dnschaos "$CHAOS_NAME" --ignore-not-found --wait=true >/dev/null 2>&1 || true
  fi
  if ((JOB_CREATED)) && ((status != 0)); then
    k -n "$NS" logs "job/$JOB" > "$OUT/client.jsonl" 2> "$OUT/client-log-error.txt" || true
    k -n "$NS" delete job "$JOB" --wait=false >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

sample() {
  {
    printf '%s ' "$(date -u +%FT%TZ)"
    k -n "$NS" get dnschaos "$CHAOS_NAME" -o json 2>/dev/null | jq -c '{phase:.status.phase,conditions:.status.conditions}' || printf '%s\n' '{}'
    k -n "$NS" get pod -l "job-name=$JOB" -o wide --no-headers 2>/dev/null || true
  } >> "$OUT/timeline.log"
}
phase() {
  label="$1"; seconds="$2"; log "PHASE $label (${seconds}s)"
  end=$((SECONDS + seconds))
  while ((SECONDS < end)); do sample; sleep 10; done
}
probe() {
  target="$1"
  k -n "$NS" exec "$POD" -- node -e 'require("dns").lookup("tawira.tawira.svc.cluster.local",(e,a)=>{if(e){console.error(e.code);process.exit(1)}console.log(a)})' > "$OUT/dns-$target.txt" 2>&1
}

PATCH="$(printf '{"metadata":{"name":"%s"},"spec":{"template":{"metadata":{"labels":{"sc03-run":"%s"}},"spec":{"nodeSelector":{"kubernetes.io/hostname":"%s"},"containers":[{"name":"loadgen","env":[{"name":"RPS","value":"%s"},{"name":"DURATION_S","value":"%s"},{"name":"RUN_ID","value":"%s"}]}]}}}}' "$JOB" "$RUN_ID" "$LOADGEN_NODE" "$RPS" "$((PRE_S + FAULT_S + POST_S + 30))" "$RUN_ID")"
k patch --local -f load/job.yaml -p "$PATCH" -o yaml > "$OUT/job.yaml"
k -n "$NS" create -f "$OUT/job.yaml" >/dev/null
JOB_CREATED=1
k -n "$NS" wait --for=condition=Ready pod -l "job-name=$JOB" --timeout=120s >/dev/null
POD="$(k -n "$NS" get pod -l "job-name=$JOB" -o jsonpath='{.items[0].metadata.name}')"
LG_IP="$(k -n "$NS" get pod "$POD" -o jsonpath='{.status.podIP}')"
LG_CIDR="$(k get node "$LOADGEN_NODE" -o jsonpath='{.spec.podCIDR}')"
[[ "${LG_IP%.*}" == "${LG_CIDR%.*}" ]] || die "load pod IP is outside its node podCIDR"
probe before
log "LOAD started run=$RUN_ID rps=$RPS duration=$((PRE_S + FAULT_S + POST_S + 30))s node=$LOADGEN_NODE"
sleep 15
[[ "$(k -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}')" == Running ]] || die "loadgen not running 15 s after start"
phase control-observation "$((PRE_S - 15))"
k -n "$NS" logs "job/$JOB" > "$OUT/control.jsonl"
node measurements/scripts/control.mjs "$OUT/control.jsonl" "$RPS" "$PRE_S" > "$OUT/control-result.json" || die "control failed; DNS fault NOT injected"
log "CONTROL OK: validated sales, volume and latency targets met"

log "FAULT DNSChaos apply $CHAOS_NAME selector=sc03-run=$RUN_ID"
k create --dry-run=client -f chaos/experiments/sc03-dns-error.yaml -o json \
  | jq --arg name "$CHAOS_NAME" --arg run "$RUN_ID" --arg duration "$((FAULT_S + 120))s" \
    '.metadata.name=$name | .spec.duration=$duration | .spec.selector.labelSelectors={"sc03-run":$run}' \
  > "$OUT/dnschaos.json"
k apply -f "$OUT/dnschaos.json" >/dev/null
FAULT_ACTIVE=1
for _ in $(seq 1 30); do
  status_json="$(k -n "$NS" get dnschaos "$CHAOS_NAME" -o json)"
  status="$(printf '%s' "$status_json" | jq -r '[.status.conditions[]? | select(.type=="Selected") | .status] | first // ""')"
  injected="$(printf '%s' "$status_json" | jq -r '[.status.conditions[]? | select(.type=="AllInjected") | .status] | first // ""')"
  [[ "$status" == True && "$injected" == True ]] && break
  sleep 2
done
[[ "$status" == True && "$injected" == True ]] || die "Chaos Mesh did not confirm Selected and AllInjected"
printf '%s\n' "$status_json" > "$OUT/dnschaos-status.json"
log "DNSChaos SELECTED=$status ALLINJECTED=$injected"
phase dns-error "$FAULT_S"

log "RESTORE DNSChaos delete $CHAOS_NAME"
k -n "$NS" delete dnschaos "$CHAOS_NAME" --wait=true >/dev/null
FAULT_ACTIVE=0
for _ in $(seq 1 30); do [[ -z "$(k -n "$NS" get dnschaos "$CHAOS_NAME" -o name 2>/dev/null)" ]] && break; sleep 2; done
[[ -z "$(k -n "$NS" get dnschaos "$CHAOS_NAME" -o name 2>/dev/null)" ]] || die "DNSChaos object did not delete"
probe after
phase recovery "$POST_S"
k -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=180s >/dev/null || die "load Job did not complete"
k -n "$NS" logs "job/$JOB" > "$OUT/client.jsonl"
d exec -i "$DB" psql -X -qAt -U postgres -v ON_ERROR_STOP=1 -v "run_id=$RUN_ID" < measurements/scripts/export-ledger.sql > "$OUT/ledger.json"
node measurements/scripts/reconcile.mjs "$OUT/client.jsonl" "$OUT/ledger.json" > "$OUT/reconcile.json"
node measurements/scripts/windows.mjs "$OUT" > "$OUT/windows.txt"
log "DONE DNS error, cleanup and recovery evidence captured"
