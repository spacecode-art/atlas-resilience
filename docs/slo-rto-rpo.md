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
- **RPO**: the amount of acknowledged (HTTP 200 with a validated `saleId`) sales that can be lost.
- **Ledger outcomes**, per tagged request, comparing client result with
  database rows:
  - *clean success*: validated sale UUID and exactly one matching row
  - *clean failure*: no validated sale acknowledgement and no row
  - *lost response*: row exists but the client did not receive a validated sale acknowledgement
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
| SC-01 | Loss of one zone's worker (one of three replicas) | 2 minutes to success ratio at or above 99.5% | 0, because the stateless tier holds no sales | Measured once: 60 s RTO, 0 acknowledged sales missing (`sc01c3`) |
| SC-02 | Database unavailable, then restored | 5 minutes after the database is back, with no manual restart of Tawira | 0 for acknowledged sales | Unmeasured |
| SC-03 to SC-07 | See each scenario doc | Set in the scenario doc **before** the run | Set in the scenario doc | Not started |

Notes:

- SC-02 tests whether Tawira recovers by itself. Supabase calls may have no
  timeout, so requests could hang rather than fail fast. This is a hypothesis
  to confirm or refute, not an assumption.
- In the original `base2` workload, retrying a sale after a lost response
  could double-charge because `process_sale` had no idempotency key. The
  2026-11-02 image refresh uses a newer Tawira version with request IDs.
  The generator supplies a fresh UUID per request and never retries, so
  `sc01c3` does not test replay or retry safety. The targeted `sc02idem1`
  replay is a separate one-run observation and does not change the SC-01 result.
- Loss of the database volume itself is design-only. The database sits outside
  Chaos Mesh (ADR-0003) and no backup is configured in this environment.

## 5. Detection

For a continuously qualifying application alert, the configured 15 s scrape
and evaluation intervals, `for: 5m` hold and Alertmanager grouping suggest
about 5.5–6 minutes to notification. This is a configuration estimate, not a
measured or universal detection floor. Consequences:

- A condition must remain above a rule's threshold for its configured hold;
  fault duration alone does not determine firing. Other rules have different
  holds (`TargetDown` uses 2 minutes), and a rate window can outlast a fault.
- SC-01 `sc01c3` had 70 client transport failures and no firing alert series.
  Server-side 5xx telemetry does not measure those failed connections.
  Remediation is tracked in [F-01](findings/F-01-sale-detection-gap.md).
- Proposed MTTD target: at most 7 minutes for a sustained fault.
- SC-02 will distinguish a missing series, an existing series with zero
  increase, and application errors serialized as HTTP 200. A database outage
  need not remove request telemetry. `absent()` alone cannot cover all three;
  external validated-sale probes and traffic-aware checks are proposed in F-01.

### Measurement validity (2026-11-02, before SC-02)
A final client summary must match the request count, validated outcomes and
run ID. Request indices must be contiguous; mixed runs, duplicates, malformed
rows and truncated logs are invalid. New summaries also declare RPS and duration
so that a complete process exit cannot disguise fewer requests than planned.
Partial logs are accepted only for the pre-fault control gate.

RTO uses send time (`sent_ts` for new runs; completion minus duration for older
logs). Only full 30 s windows with at least 20 requests can establish recovery;
a sparse interior window invalidates continuity. A partial final window cannot
establish recovery and can contradict an earlier healthy window. Recovery means
all later observed windows meet the SLO, not a promise about unobserved time.
SC-02 reports independently bucketed fault-relative and DB-ready-relative RTO;
subtracting rounded offsets would use the wrong grid. The stricter analyzer
still reports 60 s for the complete, preserved `sc01c3` evidence.

Ledger reconciliation checks every acknowledged UUID against its tagged DB row,
reports lost responses separately and rejects missing/mismatched acknowledgements,
duplicate tags or DB tags absent from the complete client log. A zero-loss result
for a stop/start of the existing volume says nothing about volume-loss recovery.

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
| 2026-10-13 | v0.1 drafted from `base2` baseline | Initial proposal; date verified against commit `10fefe2` (the earlier 2026-10-16 row was a transcription error). |
| 2026-10-13 | Defined how RTO is measured: client results bucketed in 30 s windows by send time; RTO is the start of the first window from which every later window meets the SLO (resolution 30 s). No target changed. | Section 3 set targets but no measurement method. Fixed before SC-01 runs so it cannot be chosen after seeing a result. |
| 2026-11-02 | Recorded the first valid SC-01 sale-recovery result (`sc01c3`): 60 s RTO, no acknowledged sales missing. No target changed. | HTTP-only validation had counted application errors as successes; the corrected generator requires a sale UUID and reconciles the ledger. See `scenarios/SC-01-zone-loss.md` for workload provenance and invalid attempts. |
| 2026-11-02 | Before SC-02: require complete consistent logs and full recovery windows; add independent DB-ready grid and reproducible UUID reconciliation. No target changed. | Truncated logs and partial final windows could otherwise establish misleading recovery. Reprocessing preserved `sc01c3` still gives 60 s. |
| 2026-11-07 | Added `sc02idem1` as a separate request-ID replay observation; no RTO/RPO target changed. | `sc02b` recorded one lost response. The replay tests sequential, concurrent and conflicting request-ID reuse without relabeling the outage result. |
