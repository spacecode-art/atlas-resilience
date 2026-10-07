# Spike evidence

Evidence for the [ADR-0003](../../adr/ADR-0003-target-workload.md)
environment spike. Environment: a local kind cluster (three zone-labeled
workers), the Supabase CLI stack, and the Phase 3 LGTM stack on one
machine. Redactions: the hosted-project reference is replaced with
`<project-ref>`; no credentials or personal data are included.

| File | Shows | Notes |
|---|---|---|
| `s1-cluster.txt` | kind version and node zone labels | |
| `s2-pod-logs.txt` | Tawira pod logs after login and onboarding | |
| `s3-collector-counters.txt` | Collector accepted and sent counters, Tempo service names | Counters are since a planned host reboot |
| `s3-tempo-trace.png` | Tempo Explore filtered to `atlas-demo-api`, last 15 minutes | Captured 2026-10-07 |
| `s3-golden-signals-dashboard.png` | Phase 3 Golden Signals dashboard, last 15 minutes | Light, mostly cached browser traffic. The Log Records Accepted panel showed no data (no such series in Prometheus). Metric series carried no per-replica label at capture time; fixed afterwards, see `../replica-identity/` |
| `s4-resources.txt` | Six resource samples over about a minute | Single user; a snapshot, not a load test |
| `s5-before.txt`, `s5-after.txt` | Zone spread before and after `matchLabelKeys` | The "before" file was transcribed from the terminal |