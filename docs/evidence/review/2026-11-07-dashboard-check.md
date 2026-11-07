# Dashboard evidence check

**Date:** 2026-11-07
**Classification:** read-only observability check; no scenario result derived from it

The local Atlas Grafana container was healthy and the authenticated dashboard
API returned the Golden Signals dashboard (`uid: atlas-golden-signals`, title
`Atlas Observability — Golden Signals (Tawira)`). The local kind control plane,
three workers, Tawira replicas, Prometheus and Alertmanager were also Ready or
healthy at the check.

The image endpoint still returns Grafana's explicit `No image renderer
available/installed` response; the deprecated in-process plugin is not being
installed. A host Chromium capture path is now committed as
[`scripts/capture-grafana-dashboard.sh`](../../../scripts/capture-grafana-dashboard.sh).
It rendered fixed UTC windows for `sc02c`, `sc03c` and `sc04c`; the PNGs are
linked from each scenario review. Prometheus range exports, client logs, ledger
reconciliation and scenario event logs remain authoritative, with screenshots
as corroborating visual evidence. No Grafana password or session token is stored
in this repository.
