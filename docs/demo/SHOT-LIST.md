# Demo video shot list (target 4 to 5 minutes)

Record a **live SC-04 run** (about 2.5 minutes of fault) as the on-screen
experiment; show SC-02 and SC-03 through their committed evidence. Use a visible
UTC clock. Never show `.env` files, keys or the Supabase service-role key.

| Time | Shot | Say |
|---|---|---|
| 0:00 | README top, then the failure-scenarios table | What this repo is and the honesty rule: designs, fixtures and live observations are labelled |
| 0:30 | Architecture diagram | Three-zone kind cluster, Chaos Mesh, Phase 3 stack |
| 0:50 | Grafana steady state, then `RUN_ID=<new> scripts/sc04-certificate-expiry.sh --check` | Hypothesis, blast radius and abort condition come before the fault |
| 1:20 | `--run`: control gate passes, then the fault event | No fault until `CONTROL OK` |
| 1:50 | Client failures and the dashboard; alert panel shows nothing firing | The customer-visible failure the alerts missed (F-01) |
| 2:50 | Recovery, `windows.txt` RTO line, `reconcile.json` | Sale UUIDs matched to ledger rows, not HTTP 200 |
| 3:20 | `sc03d` `verify-lost.txt`: 12 of 12 recovered | Lost responses are recoverable by retrying the same request ID |
| 3:45 | `rpo2/result.json` and the findings paragraph | What a volume loss would cost, and why the backup is not enough yet |
| 4:15 | Future Roadmap section | What is not proven |

Save as `docs/demo/atlas-resilience-demo.mp4` (the `.gitignore` allows
`docs/**/*.mp4`) or host it and link it from the README.