#!/usr/bin/env bash
# Fail if any running, non-host-network pod has an IP outside the podCIDR of its node.
# A mismatched pod is unreachable from other nodes (docs/evidence/pod-cidr-mismatch/).
# Assumes /24 per-node podCIDRs, which is the kind default.
set -euo pipefail

CONTEXT="${CONTEXT:-kind-atlas-resilience}"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]] || { echo "ABORT: kubectl context is not $CONTEXT" >&2; exit 1; }

# Capture first: failures inside process substitutions do not fail the parent
# shell under set -e, which could otherwise print OK after an API error.
KUBE=(kubectl --context "$CONTEXT" --request-timeout=10s)
nodes="$("${KUBE[@]}" get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.podCIDR}{"\n"}{end}')"
pods="$("${KUBE[@]}" get pods -A --field-selector=status.phase=Running \
  -o jsonpath='{range .items[*]}{.metadata.namespace}{"|"}{.metadata.name}{"|"}{.spec.nodeName}{"|"}{.status.podIP}{"|"}{.spec.hostNetwork}{"\n"}{end}')"

declare -A CIDR
while read -r node cidr; do
  [[ -n "$node" && "$cidr" == */24 ]] || { echo "ABORT: missing or unsupported node podCIDR" >&2; exit 1; }
  CIDR["$node"]="$cidr"
done <<< "$nodes"

bad=0
while IFS='|' read -r ns pod node ip hostnet; do
  [[ "$hostnet" == "true" || -z "$ip" || -z "$node" ]] && continue
  [[ -n "${CIDR[$node]:-}" ]] || { echo "ABORT: pod references a node without podCIDR" >&2; exit 1; }
  prefix="${CIDR[$node]%.*/*}"   # 10.244.2.0/24 -> 10.244.2
  [[ "$ip" == "$prefix".* ]] && continue
  echo "MISMATCH $ns/$pod on $node: ip $ip is outside ${CIDR[$node]}" >&2
  bad=1
done <<< "$pods"

if (( bad == 0 )); then
  echo "OK: every pod IP is inside its node's podCIDR"
fi
exit "$bad"