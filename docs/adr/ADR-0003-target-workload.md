# ADR-0003: Target Workload — Tawira on kind, Supabase CLI Stack on the Host

## Status
Proposed. Becomes Accepted if the spike below passes, or is Superseded by
the fallback if it fails. Either outcome gets recorded here, not silently
swapped.

## Date
2026-10-03

---

## Context
`atlas-resilience` needs something to break. `atlas-security` ADR-0001 and
`atlas-observability` ADR-0001 both chose Tawira (a private multi-tenant
inventory/POS SaaS: TanStack Start, Node/Nitro, Supabase) over a throwaway
sample app. The same reasoning applies here: a real application produces
real findings, and a resilience repo is only as credible as the findings it
surfaces and fixes.

Static reading of Tawira's source (160 files under `src/`) established
constraints that shape the choice. These are code-reading observations, not
measurements:

1. **It uses four Supabase services, not just Postgres.** 346 `.from()` and
   21 `.rpc()` calls (PostgREST), Auth including 26 `.auth.admin` calls,
   Storage (`lib/product-images.ts`), and one Realtime `postgres_changes`
   channel (`hooks/useAuth.tsx`). A hand-rolled in-cluster Postgres alone
   would not run the app.
2. **The browser talks to Supabase directly.** `VITE_SUPABASE_URL` is baked
   into the client bundle at build time (Dockerfile build arg), while the
   server reads `SUPABASE_URL` at runtime. The two may need different
   hostnames when Supabase is not inside the cluster.
3. **No health endpoint exists** in `src/routes`. Kubernetes probes have
   nothing meaningful to hit.
4. **Supabase calls appear to have no timeout.** The custom `fetch` in
   `client.server.ts` sets headers but passes no `signal`; only the Brevo and
   Paystack calls use `AbortSignal.timeout` (10-15 s). Hypothesis, to be
   confirmed or refuted by SC-02, not assumed.
5. **Chaos Mesh can only inject faults into things running in the cluster.**
   Anything on the host is out of its reach.

## Options considered

| Option | Verdict |
|---|---|
| **A. Tawira image on kind; Supabase CLI stack on host Docker** | Chosen, pending spike. Real app, real findings, stateless tier can be spread across zone-labeled nodes. |
| B. Tawira on the host, kind holds only chaos targets | Rejected. The app is outside the failure domain, so chaos tooling cannot touch it. |
| C. Purpose-built minimal app plus in-cluster Postgres | Fallback. Easiest to inject faults into, but breaks the Tawira through-line of Phases 2 and 3. |
| D. Full Supabase stack as manifests on kind | Rejected. Six services of undocumented-for-k8s plumbing is its own project and does not improve the resilience evidence. |

## Decision
Run Tawira (rebuilt locally from its Dockerfile) as a multi-replica
Deployment on a 3-worker kind cluster, one worker per simulated zone via
`topology.kubernetes.io/zone` node labels. Run Supabase via `supabase start`
on the host, and the Phase 3 LGTM stack via Docker Compose, so the
experiments are observable through the stack already built.

Before committing to this, run a **time-boxed spike** (hard cap: one working
session, about 4 hours).

### Spike pass criteria
All must hold; each is evidenced with a captured command output in
`docs/evidence/spike/`:

- **S1:** The locally built Tawira image boots on the kind cluster and
  stays Running.
- **S2:** A page is served and a login completes end to end against the host
  Supabase (covers the browser-URL vs server-URL split, and any JWT/issuer
  mismatch between them).
- **S3:** Traces from the pod reach the Phase 3 Collector, which also
  closes the "OTel unverified in the built container" gap in
  `atlas-observability`'s roadmap.
- **S4:** Tawira, kind, Supabase and the LGTM stack run concurrently
  without sustained swapping. Record peak memory; do not guess it.
- **S5:** Replicas schedule across all three zone-labeled workers.

### Fallback trigger
If any criterion fails and is not fixable inside the time box, switch to
Option C. The failed spike is written up here as a finding (same blameless
format as `atlas-network` ADR-0006 to 0011); it is evidence, not an embarrassment.

## Consequences
- Findings from the experiments (missing health endpoint, possible missing
  Supabase timeouts, alert blind spot for total outage) become fixes in
  Tawira with before/after evidence. Tawira is private, so this repo commits
  anonymized snippets and Tawira commit hashes, the same tradeoff accepted
  in ADR-0001 of the sibling repos.
- **The locally built image is unsigned.** It sits outside the Phase 2
  Cosign/SBOM chain. This is stated, not hidden.
- **Supabase is not subject to Chaos Mesh.** SC-02 uses scripted container
  faults on the host plus NetworkChaos on Tawira's egress, and the scenario
  doc says so. Loss of the database's own zone cannot be simulated and is
  documented as design-only.
- The stateless tier (Tawira) gets genuine zone-failure experiments (SC-01);
  the stateful tier does not. This asymmetry is a limit of the local
  environment and is recorded in `docs/architecture/failure-domains.md`.
- A seventh scenario, SC-07 (third-party dependency failure: Brevo,
  Paystack, M-Pesa), is added because those calls already carry explicit
  timeouts worth testing.