#!/usr/bin/env bash
# SC-04: expire a leaf certificate at the disposable HTTPS boundary.
# The proxy, CA and certificates are local test resources; Tawira and Supabase
# remain outside the fault. --check is read-only. --run is attended and bounded.
set -euo pipefail

CONTEXT="kind-atlas-resilience"
NS="tawira"
RUN_ID="${RUN_ID:?set RUN_ID, e.g. RUN_ID=sc04a}"
DB="${DB:?set DB to the verified local Supabase Postgres container}"
LOCAL_PROJECT="${LOCAL_PROJECT:?set LOCAL_PROJECT to that container project label}"
MODE="${1:-}"
LOADGEN_NODE="${LOADGEN_NODE:-atlas-resilience-worker2}"
RPS="${RPS:-5}"
PRE_S="${PRE_S:-120}"
FAULT_S="${FAULT_S:-60}"
POST_S="${POST_S:-180}"
JOB="loadgen-${RUN_ID}"
OUT="measurements/results/${RUN_ID}"
TMP=""
JOB_CREATED=0
PROXY_CREATED=0

die() { echo "ABORT: $*" >&2; exit 1; }
[[ "$MODE" == "--check" || "$MODE" == "--run" ]] || die "usage: DB=... LOCAL_PROJECT=... RUN_ID=... $0 --check|--run"
[[ "$RUN_ID" =~ ^[a-z0-9]{1,16}$ ]] || die "RUN_ID must match [a-z0-9]{1,16}"
for v in RPS PRE_S FAULT_S POST_S; do [[ "${!v}" =~ ^[0-9]+$ ]] || die "$v must be an integer"; done
(( RPS > 0 && PRE_S >= 60 && FAULT_S >= 30 && POST_S >= 60 )) || die "invalid phase duration"

k() { kubectl --context "$CONTEXT" --request-timeout=10s "$@"; }
d() { docker --host unix:///var/run/docker.sock "$@"; }

preflight() {
  command -v openssl >/dev/null || die "openssl is required for ephemeral test certificates"
  command -v jq >/dev/null || die "jq is required for manifest construction"
  [[ "$(k config current-context)" == "$CONTEXT" ]] || die "kubectl context is not $CONTEXT"
  [[ "$(d inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" == true ]] || die "DB is not running"
  [[ "$(d inspect -f '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB")" == "$LOCAL_PROJECT" ]] || die "DB project label does not match LOCAL_PROJECT"
  [[ "$(d exec "$DB" psql -X -qAt -U postgres -c "select count(*) from public.products where shop_id='d841607b-9f0e-447b-998b-efec2e6d89e0'::uuid and sku like 'LG-%' and not is_deleted;")" == 20 ]] || die "expected 20 seeded LG-* products"
  [[ "$(k -n "$NS" get deploy tawira -o jsonpath='{.status.readyReplicas}')" == 3 ]] || die "Tawira is not 3/3 Ready"
  k -n "$NS" get secret loadgen-env >/dev/null || die "loadgen-env Secret missing"
  for file in loadgen.mjs sale-result.mjs; do
    path="${file//./\\.}"
    live_hash="$(k -n "$NS" get configmap loadgen-script -o "jsonpath={.data.$path}" | sha256sum | awk '{print $1}')"
    local_hash="$(sha256sum "load/$file" | awk '{print $1}')"
    [[ "$live_hash" == "$local_hash" ]] || die "ConfigMap $file differs from local code; refresh it"
  done
  [[ -z "$(k -n "$NS" get jobs -o json | jq -r '.items[] | select(.status.active > 0) | .metadata.name')" ]] || die "another load Job is active"
  [[ -z "$(k -n "$NS" get deploy sc04-tls-proxy -o name 2>/dev/null)" ]] || die "sc04 TLS proxy already exists; clean the prior session"
  CONTEXT="$CONTEXT" bash scripts/check-pod-cidrs.sh >/dev/null
}

if [[ "$MODE" == "--check" ]]; then
  preflight
  echo "SC-04 preflight passed: local DB, Tawira replicas, load code and disposable boundary prerequisites are healthy"
  exit 0
fi

preflight
mkdir -p measurements/results
mkdir "$OUT" || die "$OUT already exists; choose a new RUN_ID"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/atlas-sc04.XXXXXX")"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$OUT/events.log"; }

cleanup() {
  status=$?
  trap - EXIT
  if ((JOB_CREATED)); then
    k -n "$NS" logs "job/$JOB" > "$OUT/client.jsonl" 2> "$OUT/client-log-error.txt" || true
    if ((status != 0)); then k -n "$NS" delete job "$JOB" --wait=false >/dev/null 2>&1 || true; fi
  fi
  if ((PROXY_CREATED)); then
    k -n "$NS" delete -f tls/sc04-tls-proxy.yaml --ignore-not-found --wait=true >/dev/null 2>&1 || true
    k -n "$NS" delete configmap sc04-tls-proxy-script secret sc04-tls-cert sc04-tls-ca --ignore-not-found >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cat >"$TMP/openssl.cnf" <<EOF
[ ca ]
default_ca = local_ca
[ local_ca ]
dir = $TMP
database = $TMP/index.txt
new_certs_dir = $TMP/newcerts
serial = $TMP/serial
certificate = $TMP/ca.crt
private_key = $TMP/ca.key
default_md = sha256
policy = local_policy
[ local_policy ]
commonName = supplied
[ leaf ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
subjectAltName = DNS:sc04-tls-proxy.tawira.svc.cluster.local,DNS:sc04-tls-proxy
EOF
mkdir "$TMP/newcerts"
: >"$TMP/index.txt"
echo 1000 >"$TMP/serial"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
  -subj "/CN=Atlas SC04 Test CA" -keyout "$TMP/ca.key" -out "$TMP/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 \
  -subj "/CN=sc04-tls-proxy.tawira.svc.cluster.local" -keyout "$TMP/leaf.key" -out "$TMP/leaf.csr" >/dev/null 2>&1
openssl ca -batch -config "$TMP/openssl.cnf" -extensions leaf -in "$TMP/leaf.csr" \
  -out "$TMP/valid.crt" -days 20 >/dev/null 2>&1
openssl req -new -key "$TMP/leaf.key" \
  -subj "/CN=sc04-expired-leaf" -out "$TMP/expired.csr" >/dev/null 2>&1
start="$(date -u -d '2 days ago' +%y%m%d%H%M%SZ)"
end="$(date -u -d '1 day ago' +%y%m%d%H%M%SZ)"
openssl ca -batch -config "$TMP/openssl.cnf" -extensions leaf -in "$TMP/expired.csr" \
  -startdate "$start" -enddate "$end" -out "$TMP/expired.crt" >/dev/null 2>&1
openssl x509 -in "$TMP/valid.crt" -noout -dates -serial > "$OUT/valid-certificate.txt"
openssl x509 -in "$TMP/expired.crt" -noout -dates -serial > "$OUT/expired-certificate.txt"

k -n "$NS" create configmap sc04-tls-proxy-script --from-file=sc04-proxy.mjs=tls/sc04-proxy.mjs \
  --dry-run=client -o yaml | k apply -f - >/dev/null
k -n "$NS" create secret generic sc04-tls-ca --from-file=ca.crt="$TMP/ca.crt" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
k -n "$NS" create secret tls sc04-tls-cert --cert="$TMP/valid.crt" --key="$TMP/leaf.key" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
k apply -f tls/sc04-tls-proxy.yaml >/dev/null
PROXY_CREATED=1
k -n "$NS" rollout status deploy/sc04-tls-proxy --timeout=120s >/dev/null
PROXY_POD="$(k -n "$NS" get pod -l app=sc04-tls-proxy -o jsonpath='{.items[0].metadata.name}')"
k -n "$NS" get pod "$PROXY_POD" -o json > "$OUT/proxy-before.json"
PROXY_IMAGE_ID="$(jq -r '.status.containerStatuses[0].imageID' "$OUT/proxy-before.json")"
jq -n --arg run "$RUN_ID" --arg context "$CONTEXT" --arg node "$LOADGEN_NODE" \
  --arg image "$PROXY_IMAGE_ID" --arg commit "$(git rev-parse HEAD)" \
  --argjson rps "$RPS" --argjson pre "$PRE_S" --argjson fault "$FAULT_S" --argjson post "$POST_S" \
  '{scenario:"SC-04",mode:"run",run:$run,context:$context,loadgen_node:$node,rps:$rps,
    control_s:$pre,fault_s:$fault,recovery_s:$post,proxy_image_id:$image,source_commit:$commit,
    started_at:now|todate}' > "$OUT/run.json"

JOB_JSON="$(k create --dry-run=client -f load/job.yaml -o json | jq \
  --arg name "$JOB" --arg run "$RUN_ID" --arg node "$LOADGEN_NODE" \
  --arg target "https://sc04-tls-proxy.tawira.svc.cluster.local" \
  --arg duration "$((PRE_S + FAULT_S + POST_S + 30))" --arg rps "$RPS" \
  '.metadata.name=$name | .spec.template.metadata.labels["sc04-run"]=$run |
   .spec.template.spec.nodeSelector={"kubernetes.io/hostname":$node} |
   .spec.template.spec.containers[0].env=((.spec.template.spec.containers[0].env // []) +
     [{name:"RPS",value:$rps},{name:"DURATION_S",value:$duration},{name:"RUN_ID",value:$run},
      {name:"TARGET_URL",value:$target},{name:"NODE_EXTRA_CA_CERTS",value:"/tls-ca/ca.crt"}]) |
   .spec.template.spec.containers[0].volumeMounts=((.spec.template.spec.containers[0].volumeMounts // []) +
     [{name:"tls-ca",mountPath:"/tls-ca",readOnly:true}]) |
   .spec.template.spec.volumes=((.spec.template.spec.volumes // []) +
     [{name:"tls-ca",secret:{secretName:"sc04-tls-ca"}}])')"
printf '%s\n' "$JOB_JSON" > "$OUT/job.json"
k -n "$NS" create -f "$OUT/job.json" >/dev/null
JOB_CREATED=1
k -n "$NS" wait --for=condition=Ready pod -l "job-name=$JOB" --timeout=120s >/dev/null
POD="$(k -n "$NS" get pod -l "job-name=$JOB" -o jsonpath='{.items[0].metadata.name}')"

probe() {
  label="$1"
  # The JavaScript is evaluated inside the load pod, not by this shell.
  # shellcheck disable=SC2016
  if k -n "$NS" exec "$POD" -- node -e 'const https=require("https"),u=new URL(process.env.TARGET_URL);const r=https.get(u,{headers:{connection:"close"}},x=>{console.log(`HTTP ${x.statusCode}`);x.resume();x.on("end",()=>process.exit(0));});r.on("socket",s=>s.on("secureConnect",()=>console.log(JSON.stringify({serial:s.getPeerCertificate().serialNumber,valid_to:s.getPeerCertificate().valid_to}))));r.on("error",e=>{console.error(e.code||e.message);process.exit(1)});' >"$OUT/https-$label.txt" 2>&1; then
    return 0
  fi
  return 1
}
wait_proxy_cert() {
  expected="$1"
  for _ in $(seq 1 30); do
    actual="$(k -n "$NS" exec "$PROXY_POD" -- node -e 'const {X509Certificate}=require("crypto"),fs=require("fs");console.log(new X509Certificate(fs.readFileSync("/tls/tls.crt")).serialNumber)' 2>/dev/null || true)"
    [[ "$actual" == "$expected" ]] && return 0
    sleep 2
  done
  die "proxy Secret mount did not expose certificate serial $expected"
}
probe before || die "valid certificate did not complete a new HTTPS handshake"
log "LOAD started run=$RUN_ID rps=$RPS duration=$((PRE_S + FAULT_S + POST_S + 30))s target=https://sc04-tls-proxy"
sleep 15
[[ "$(k -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}')" == Running ]] || die "loadgen not running 15 s after start"
end=$((SECONDS + PRE_S - 15))
while ((SECONDS < end)); do date -u +%FT%TZ > /dev/null; sleep 10; done
k -n "$NS" logs "job/$JOB" > "$OUT/control.jsonl"
node measurements/scripts/control.mjs "$OUT/control.jsonl" "$RPS" "$PRE_S" > "$OUT/control-result.json" || die "control failed; certificate fault NOT injected"
log "CONTROL OK: HTTPS handshakes, validated sales, volume and latency targets met"

log "CERTIFICATE install expired leaf; proxy remains running"
k -n "$NS" create secret tls sc04-tls-cert --cert="$TMP/expired.crt" --key="$TMP/leaf.key" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
EXPIRED_SERIAL="$(openssl x509 -in "$TMP/expired.crt" -noout -serial | cut -d= -f2)"
wait_proxy_cert "$EXPIRED_SERIAL"
k -n "$NS" exec "$PROXY_POD" -- node -e 'process.kill(1,"SIGHUP")'
sleep 3
k -n "$NS" get pod "$PROXY_POD" -o json > "$OUT/proxy-expired.json"
[[ "$(jq -r '.status.startTime' "$OUT/proxy-before.json")" == "$(jq -r '.status.startTime' "$OUT/proxy-expired.json")" ]] || die "proxy pod restarted during certificate expiry"
[[ "$(jq -r '[.status.containerStatuses[]?.restartCount] | all(. == 0)' "$OUT/proxy-expired.json")" == true ]] || die "proxy container restarted during certificate expiry"
probe expired && die "expired certificate unexpectedly completed a trusted handshake"
log "FAULT certificate expired reload sc04-tls-proxy"
end=$((SECONDS + FAULT_S)); while ((SECONDS < end)); do sleep 10; done

log "CERTIFICATE install valid leaf and reload proxy"
k -n "$NS" create secret tls sc04-tls-cert --cert="$TMP/valid.crt" --key="$TMP/leaf.key" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
VALID_SERIAL="$(openssl x509 -in "$TMP/valid.crt" -noout -serial | cut -d= -f2)"
wait_proxy_cert "$VALID_SERIAL"
k -n "$NS" exec "$PROXY_POD" -- node -e 'process.kill(1,"SIGHUP")'
sleep 3
probe after || die "valid certificate did not restore a new HTTPS handshake"
k -n "$NS" get pod "$PROXY_POD" -o json > "$OUT/proxy-after.json"
[[ "$(jq -r '.status.startTime' "$OUT/proxy-before.json")" == "$(jq -r '.status.startTime' "$OUT/proxy-after.json")" ]] || die "proxy pod restarted during certificate recovery"
[[ "$(jq -r '[.status.containerStatuses[]?.restartCount] | all(. == 0)' "$OUT/proxy-after.json")" == true ]] || die "proxy container restarted during certificate recovery"
log "RESTORE certificate reload sc04-tls-proxy"
end=$((SECONDS + POST_S)); while ((SECONDS < end)); do sleep 10; done

k -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=180s >/dev/null || die "load Job did not complete"
k -n "$NS" logs "job/$JOB" > "$OUT/client.jsonl"
d exec -i "$DB" psql -X -qAt -U postgres -v ON_ERROR_STOP=1 -v "run_id=$RUN_ID" < measurements/scripts/export-ledger.sql > "$OUT/ledger.json"
node measurements/scripts/reconcile.mjs "$OUT/client.jsonl" "$OUT/ledger.json" > "$OUT/reconcile.json"
node measurements/scripts/windows.mjs "$OUT" > "$OUT/windows.txt"
k -n "$NS" logs deploy/sc04-tls-proxy > "$OUT/proxy.log"
log "DONE certificate expiry, reload and recovery evidence captured"
