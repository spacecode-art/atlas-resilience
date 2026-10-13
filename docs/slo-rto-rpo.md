# SLOs, RTO and RPO

## Status
Draft v0.1, 2026-10-13. Section 1 is measured. Sections 3 to 5 are
**proposed targets, written before the experiments run**, so that an
experiment can fail. A target is only revised through a changelog entry that
states why (section 7).

---

## 1. Steady state (measured)

Reference run `base2`: open-loop load, 5 requests per second for 600 seconds,
against three Tawira replicas on the three-zone kind cluster.

| Measure | Value | Source |
|---|---|---|
| Sales sent | 3000 | client summary |
| HTTP 200 | 3000 (0 non-200) | client summary |
| Rows in `public.sales` with the run tag | 3000, 3000 distinct tags | database |
| Duplicates / lost / ambiguous | 0 / 0 / 0 | ledger comparison |
| Stock after run | 196988, consistent with 3000 sales at quantity 1 | database |
| Client latency p50 / p95 / p99 | 97 ms / 410 ms / 761 ms | client summary |
| 5xx rate | 0% | Golden Signals dashboard |
| Event-loop utilization | low, read by eye from the dashboard | Golden Signals dashboard |

Evidence: `docs/evidence/baseline/base2-reconcile.txt` and
`docs/evidence/baseline/golden-signals-steady-state.png`.

Caveats, stated up front:

- 5 RPS is low traffic on one host. It is a reference, not a capacity claim.
- p99 is about 8 times p50 with zero errors. The cause is **not yet
  established**. Candidate causes are a new connection per request, row-lock
  contention in `process_sale`, and tracing overhead. None has been measured.
- Dashboard percentiles are interpolated from histogram buckets. Client-side
  figures are the measurement; the dashboard is corroboration.

## 2. Definitions

- **SLI**: a measured ratio or latency (for example, successful sales divided
  by sales sent).
- **SLO**: the objective an SLI must meet.
- **MTTD**: time from fault injection to the first alert that fires.
- **RTO**: time from fault injection until the success ratio is back within
  its SLO and stays there.
- **RPO**: the amount of acknowledged (HTTP 200) sales that can be lost.
- **Ledger outcomes**, per tagged request, comparing client result with
  database rows:
  - *clean success*: 200 and exactly one row
  - *clean failure*: not 200 and no row
  - *lost response*: row exists but the client did not see a 200
  - *duplicate*: more than one row for one tag
  - *ambiguous*: client saw no definite result and a row exists

## 3. Proposed SLOs

| SLI | Objective | Basis |
|---|---|---|
| Sale success ratio (200 with a `saleId`, over sales sent) | At least 99.5% | Baseline is 3000 of 3000. Zero failures in 3000 only bounds the true failure rate at roughly 0.1% (rule of three), so a tighter objective is not justified by this sample. |
| Sale latency p95 (client-measured) | At most 1 s | About 2.4 times the baseline p95 of 410 ms. |
| Sale latency p99 (client-measured) | At most 2 s | About 2.6 times the baseline p99 of 761 ms. |
| Duplicate sales | 0 | A duplicate is a double charge. No fault is allowed to produce one silently. |

The latency multiples are a judgment call, not a derivation, and are revisited
once the tail in section 1 is explained.

Error budget at 99.5% over 30 days: 0.5% of 720 hours, which is 3.6 hours of
total-outage equivalent.

## 4. Proposed recovery targets per scenario

| Scenario | Fault | RTO target | RPO target | Status |
|---|---|---|---|---|
| SC-01 | Loss of one zone's worker (one of three replicas) | 2 minutes to success ratio at or above 99.5% | 0, because the stateless tier holds no sales | Unmeasured |
| SC-02 | Database unavailable, then restored | 5 minutes after the database is back, with no manual restart of Tawira | 0 for acknowledged sales | Unmeasured |
| SC-03 to SC-07 | See each scenario doc | Set in the scenario doc **before** the run | Set in the scenario doc | Not started |

Notes:

- SC-02 tests whether Tawira recovers by itself. Supabase calls may have no
  timeout, so requests could hang rather than fail fast. This is a hypothesis
  to confirm or refute, not an assumption.
- Retrying a sale after a lost response may double-charge, because
  `process_sale` has no idempotency key. The ledger exists to test this.
- Loss of the database volume itself is design-only. The database sits outside
  Chaos Mesh (ADR-0003) and no backup is configured in this environment.

## 5. Detection

The alerting pipeline has a computed floor of about 5.5 to 6 minutes between a
fault and a page: 15 s scrape and evaluation, a `for: 5m` hold, and
Alertmanager grouping. This is derived from the `atlas-observability` rules,
not measured here. Consequences:

- A fault shorter than about 6 minutes cannot page.
- Proposed MTTD target: at most 7 minutes for a sustained fault.
- Hypothesis for SC-02: during a total outage there is no traffic, so
  `HighErrorRate` has no series to evaluate and may never fire. If confirmed,
  the fix is an alert on absence (`absent()`), recorded as a finding with
  before and after evidence.

## 6. Limits of this environment

- All three zones are node labels on one host, so correlated and host-level
  failures cannot be tested.
- The database and the observability stack are outside the cluster and outside
  Chaos Mesh.
- The Tawira image is built locally and is unsigned, outside the Phase 2
  signing chain.

## 7. Revision rule

A target changes only through a dated entry below stating what changed and why.
A target is never edited after seeing the result it would have judged,
without the original left visible.

| Date | Change | Reason |
|---|---|---|
| 2026-10-13 | v0.1 drafted from `base2` baseline | Initial proposal |