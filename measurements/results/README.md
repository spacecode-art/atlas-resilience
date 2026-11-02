# Local run evidence

`sc01c3/client.jsonl` is the complete validated request log; its summary has
5,550 sent, 5,480 acknowledged sales and 70 failed connections. Use this file,
`events.log`, `windows.txt` and `reconcile.json` for the measured result.
Raw capture files are retained as generated; whitespace in Helm/psql output is
not a data correction. Local `live-client.jsonl` files are incomplete snapshots
and are excluded from version control and analysis.

| Directory | Interpretation |
|---|---|
| `sc01a` | Invalid network/control; no sale recovery finding. |
| `sc01a2` | Startup failure with no request rows; cause not newly attributed. |
| `sc01b` | Invalid: expired trial hid the seeded products. |
| `sc01c` | Interrupted during control; no worker fault. |
| `sc01c2` | Invalid: HTTP 200 application errors and zero sales. Its HTTP-only RTO is not a sale RTO. |
| `sc01c3` | One valid local sale-recovery run; 60 s RTO at 30 s resolution. |
| `smoke20261102` | Invalid HTTP-only smoke; business failures were initially missed. |
| `smoke20261102b` | 150 acknowledged sales and 150 unique matching ledger rows. |

Image provenance is in `image-refresh20261102.txt`. The valid run predates
later manifest security settings, explicit recovery-failure exits and ADR-0005;
those changes must not be represented as configurations measured in that run.
