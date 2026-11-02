#!/usr/bin/env bash
# SC-01: loss of one zone's worker (kind node container). Local environment only.
# Why a script and not a Chaos Mesh CRD (ADR-0002 rule): Chaos Mesh acts through chaos-daemon,
# which runs ON the node, so it cannot remove the node itself. `docker kill` (SIGKILL, no clean
# shutdown, kubelet gets no chance to deregister) is the nearest local analogue of a zone loss.
# The node is restored on exit, including on Ctrl-C.
set -euo pipefail
CONTEXT="kind-atlas-resilience"
NS="tawira"
VICTIM="${VICTIM:-atlas-resilience-worker3}"          # fixed victim; preflight checks current CoreDNS placement
LOADGEN_NODE="${LOADGEN_NODE:-atlas-resilience-worker2}"
RUN_ID="${RUN_ID:?set RUN_ID, e.g. RUN_ID=sc01a}"
RPS="${RPS:-5}"
PRE_S="${PRE_S:-120}"
HOLD_S="${HOLD_S:-480}"
POST_S="${POST_S:-480}"
OUT="measurements/results/${RUN_ID}"

die() { echo "ABORT: $*" >&2; exit 1; }

[[ "$RUN_ID" =~ ^[a-z0-9]{1,16}$ ]] || die "RUN_ID must match [a-z0-9]{1,16}"
for v in RPS PRE_S HOLD_S POST_S; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || die "$v must be a non-negative integer"
done
((RPS > 0)) || die "RPS must be positive"
((PRE_S >= 60)) || die "PRE_S must be at least 60 seconds for the control gate"
DURATION_S=$((PRE_S + HOLD_S + POST_S + 30))

# ---- preflight: nothing below changes the cluster until all of this passes ----
[[ "$(kubectl config current-context)" == "$CONTEXT" ]] || die "kubectl context is not $CONTEXT"
[[ "$VICTIM" != "$LOADGEN_NODE" ]] || die "victim and loadgen node must differ"
[[ "$(docker inspect -f '{{.State.Running}}' "$VICTIM" 2>/dev/null)" == "true" ]] || die "$VICTIM is not running"
ZONE="$(kubectl get node "$VICTIM" -o jsonpath='{.metadata.labels.topology\.kubernetes\.io/zone}')"
[[ -n "$ZONE" ]] || die "$VICTIM has no zone label"
node_ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"; }
IP_BEFORE="$(node_ip "$VICTIM")"
[[ "$(kubectl -n "$NS" get deploy tawira -o jsonpath='{.status.readyReplicas}')" == "3" ]] || die "tawira is not 3/3 ready"
kubectl -n "$NS" get secret loadgen-env >/dev/null || die "secret loadgen-env missing"
kubectl -n "$NS" get configmap loadgen-script >/dev/null || die "configmap loadgen-script missing"
DNS_NODES="$(kubectl -n kube-system get pods -l k8s-app=kube-dns -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}')"
if grep -qx "$VICTIM" <<<"$DNS_NODES" && [[ "${ALLOW_DNS_CONFOUND:-0}" != "1" ]]; then
  die "CoreDNS runs on $VICTIM: DNS lookups would fail for all traffic. Pick another VICTIM."
fi

mkdir -p measurements/results
mkdir "$OUT" || die "$OUT already exists; choose a new RUN_ID (evidence is never overwritten)"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$OUT/events.log"; }
LOAD_CREATED=0
restore() {
  local status=$?
  trap - EXIT
  if [[ "$(docker inspect -f '{{.State.Running}}' "$VICTIM" 2>/dev/null)" != "true" ]]; then
    log "RESTORE docker start $VICTIM (trap)"
    docker start "$VICTIM" >/dev/null || true
  fi
  if ((LOAD_CREATED)); then
    kubectl --request-timeout=10s -n "$NS" logs job/loadgen > "$OUT/client.jsonl" 2> "$OUT/client-log-error.txt" || true
  fi
  return "$status"
}
trap restore EXIT
trap 'exit 130' INT TERM

sample() {
  local ready
  ready="$(kubectl -n "$NS" get endpointslices -l kubernetes.io/service-name=tawira \
    -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\n"}{end}' | grep -c true || true)"
  {
    echo "--- $(date -u +%FT%TZ) ready_endpoints=${ready}"
    kubectl get node "$VICTIM" --no-headers
    kubectl -n "$NS" get pods -l app=tawira --no-headers -o wide
  } >> "$OUT/timeline.log" 2>&1 || true
}
phase() {
  local end=$((SECONDS + $2))
  log "PHASE $1 (${2}s)"
  while ((SECONDS < end)); do sample; sleep 10; done
}

{
  kubectl get nodes -o wide
  kubectl -n "$NS" get pods -o wide
  kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
  echo "## kube-controller-manager command"
  kubectl -n kube-system get pod -l component=kube-controller-manager \
    -o jsonpath='{.items[0].spec.containers[0].command}{"\n"}'
} > "$OUT/before.txt" 2>&1 || true

# ---- load: pinned away from the victim; env overrides envFrom, so load/.env is untouched ----
kubectl -n "$NS" delete job loadgen --ignore-not-found --wait=true >/dev/null
PATCH="$(printf '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/hostname":"%s"},"containers":[{"name":"loadgen","env":[{"name":"RPS","value":"%s"},{"name":"DURATION_S","value":"%s"},{"name":"RUN_ID","value":"%s"}]}]}}}}' \
  "$LOADGEN_NODE" "$RPS" "$DURATION_S" "$RUN_ID")"
kubectl patch --local -f load/job.yaml -p "$PATCH" -o yaml | kubectl -n "$NS" create -f - >/dev/null
LOAD_CREATED=1
for _ in $(seq 1 60); do
  [[ -n "$(kubectl -n "$NS" get pod -l job-name=loadgen -o name)" ]] && break
  sleep 2
done
kubectl -n "$NS" wait --for=condition=Ready pod -l job-name=loadgen --timeout=120s >/dev/null
LG_IP="$(kubectl -n "$NS" get pod -l job-name=loadgen -o jsonpath='{.items[0].status.podIP}')"
LG_CIDR="$(kubectl get node "$LOADGEN_NODE" -o jsonpath='{.spec.podCIDR}')"
if [[ "${LG_IP%.*}" != "${LG_CIDR%.*}" ]]; then   # kind uses /24 per node
  kubectl -n "$NS" delete job loadgen --ignore-not-found >/dev/null
  die "loadgen pod IP $LG_IP is outside $LOADGEN_NODE podCIDR $LG_CIDR: node network is broken; fault NOT injected"
fi
log "LOAD started run=$RUN_ID rps=$RPS duration=${DURATION_S}s node=$LOADGEN_NODE ip=$LG_IP"

# ---- control: never inject a fault on failed startup or an unhealthy baseline ----
log "PHASE steady-state (${PRE_S}s)"
sleep 15
[[ "$(kubectl -n "$NS" get pod -l job-name=loadgen -o jsonpath='{.items[0].status.phase}')" == "Running" ]] || die "loadgen not running 15 s after start; fault NOT injected (see client.jsonl)"
phase control-observation "$((PRE_S - 15))"
kubectl -n "$NS" logs job/loadgen > "$OUT/control.jsonl"
[[ "$(kubectl -n "$NS" get pod -l job-name=loadgen -o jsonpath='{.items[0].status.phase}')" == "Running" ]] || die "loadgen exited during control; fault NOT injected"
# Require baseline traffic volume, success SLO and latency SLO before touching the worker.
node measurements/scripts/control.mjs "$OUT/control.jsonl" "$RPS" "$PRE_S" \
  > "$OUT/control-result.json" || die "steady-state control failed; fault NOT injected"
log "CONTROL OK: traffic >=90% expected, success >=99.5%, p95 <=1s, p99 <=2s"

# ---- experiment ----
log "FAULT docker kill $VICTIM (zone $ZONE)"
docker kill "$VICTIM" >/dev/null
phase zone-down "$HOLD_S"
log "RESTORE docker start $VICTIM"
docker start "$VICTIM" >/dev/null
if kubectl wait --for=condition=Ready "node/$VICTIM" --timeout=300s >/dev/null; then
  log "NODE Ready"
else
  log "WARN $VICTIM not Ready after 300s: recovery numbers are not trustworthy"
  die "node recovery could not be verified; run is invalid"
fi
IP_AFTER="$(node_ip "$VICTIM")"
if [[ "$IP_AFTER" == "$IP_BEFORE" ]]; then log "NODE IP unchanged ($IP_BEFORE)"
else
  log "WARN NODE IP CHANGED $IP_BEFORE -> $IP_AFTER: recovery numbers are not trustworthy"
  die "node network identity changed; run is invalid"
fi
phase recovery "$POST_S"

kubectl -n "$NS" wait --for=condition=complete job/loadgen --timeout=300s >/dev/null || log "WARN loadgen job not complete"
kubectl -n "$NS" logs job/loadgen > "$OUT/client.jsonl"
{ kubectl get nodes -o wide; kubectl -n "$NS" get pods -o wide; } > "$OUT/after.txt" 2>&1 || true
log "DONE. Next: ledger reconcile, then node measurements/scripts/windows.mjs $OUT"
