# SC-03 injector readiness — 2026-11-07

This check validates the local prerequisites for SC-03. It does not inject DNS
errors and is not a DNS outage or recovery result.

| Check | Observed result |
|---|---|
| Chaos DNS Server | `chaos-dns-server-748b9477d7-8lft`, `1/1 Running` |
| DNSChaos API | CRD serves `v1alpha1`; the SC-03 fixture passed `kubectl apply --dry-run=server` earlier in this session |
| Namespace scope | `tawira` annotation `chaos-mesh.org/inject=enabled` |
| Active experiments | No `DNSChaos` object in `tawira` |
| Load selector | Completed smoke pod `loadgen-sc02smk7-9rg9h` has `app=loadgen` and reached `Succeeded` |
| Other Jobs | `loadgen-sc02smk7` completed; no active load Job was present |

The readiness commands were read-only Kubernetes queries. They establish that
the injector and selector are available, not that DNS error injection works.
The next SC-03 session must still prove the resolver query, `Selected` and
`AllInjected` conditions, client failure shape, deletion cleanup and complete
recovery windows before reporting a hypothesis result.
