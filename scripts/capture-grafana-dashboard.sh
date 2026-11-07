#!/usr/bin/env bash
# Capture a fixed UTC dashboard window with the host's Chromium browser.
# Grafana's deprecated image-renderer plugin is not required for this local path.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 OUTPUT.png FROM_EPOCH_MS TO_EPOCH_MS" >&2
  exit 2
fi

out=$1
from_ms=$2
to_ms=$3
grafana_url=${GRAFANA_URL:-http://127.0.0.1:3000}
width=${GRAFANA_SCREENSHOT_WIDTH:-1600}
height=${GRAFANA_SCREENSHOT_HEIGHT:-2200}
budget_ms=${GRAFANA_SCREENSHOT_BUDGET_MS:-12000}

command -v chromium >/dev/null || { echo "chromium is required for local dashboard capture" >&2; exit 1; }
[[ $from_ms =~ ^[0-9]+$ && $to_ms =~ ^[0-9]+$ && $from_ms -lt $to_ms ]] || {
  echo "FROM_EPOCH_MS and TO_EPOCH_MS must be increasing integers" >&2
  exit 2
}
mkdir -p "$(dirname "$out")"

chromium --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size="${width},${height}" \
  --virtual-time-budget="$budget_ms" \
  --screenshot="$out" \
  "${grafana_url}/d/atlas-golden-signals/atlas-observability-e28094-golden-signals-tawira?orgId=1&from=${from_ms}&to=${to_ms}"
