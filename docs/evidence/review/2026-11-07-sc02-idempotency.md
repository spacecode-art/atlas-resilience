# SC-02 idempotency replay review — 2026-11-07

## Scope

This is a targeted black-box observation of Tawira's sale endpoint after the
`sc02b` database outage recorded one lost response. It tests whether the
request ID carried by the sale payload prevents a retry from creating a second
sale. It is separate from the outage RTO measurement and is one local
observation, not a general application or production guarantee.

The probe ran as `sc02idem1` against the Tawira Service through a temporary
`kubectl port-forward` (`127.0.0.1:13000 -> service port 3000`). The selected
local Postgres container was running and healthy. The exact script and image
provenance are recorded in `measurements/results/sc02idem1/run.json`.

## Cases and result

| Case | Requests | Ledger result | Response result |
|---|---:|---|---|
| A: sequential duplicate `requestId` and tag | 2 | 1 row | Both responses acknowledged the same sale UUID |
| B: concurrent duplicate `requestId` and tag | 2 | 1 row | Both responses acknowledged the same sale UUID |
| C: same `requestId`, new tag and quantity | 2 | 1 row, no row for the second tag | First request acknowledged; second returned an HTTP 200 application error |

The verifier reported zero safety failures and zero contract gaps. The raw
responses and read-only ledger export are preserved in
`measurements/results/sc02idem1/replay.json` and `ledger.json`.

## Interpretation

The observed endpoint reused the original sale for sequential and concurrent
duplicates, and rejected the conflicting second payload without creating a
second ledger row. This supports request-level idempotency for the tested
endpoint and payload shape. It explains why a lost response in `sc02b` is not
by itself proof of a duplicate sale when the client retries with the same
request ID.

The result does not prove safety for a new request ID, another endpoint,
different payload fields, a different application version, or a database
failure occurring between commit and acknowledgement. Repeat the probe after
the next image refresh before making a broader claim.
