# SC-04: certificate expiry at a local TLS boundary
## Status

Boundary implemented 2026-11-07 and fixture-tested. One live expiry run is
recorded below; repeat runs are still needed before making a general TLS
availability claim. The existing Tawira HTTP Service remains unchanged; SC-04
uses a disposable HTTPS proxy and a separate load profile.

## Boundary implementation

The repository now contains a disposable, in-cluster Node TLS reverse proxy in
[`tls/sc04-tls-proxy.yaml`](../../tls/sc04-tls-proxy.yaml), with the proxy
implementation in [`tls/sc04-proxy.mjs`](../../tls/sc04-proxy.mjs). It forwards
to `tawira:3000`, exposes `sc04-tls-proxy.tawira.svc.cluster.local:443`, and
leaves the existing HTTP SC-01/SC-02 path unchanged. The attended runner
[`scripts/sc04-certificate-expiry.sh`](../../scripts/sc04-certificate-expiry.sh)
generates a session CA and leaf certificates in a temporary directory and
mounts the CA only into the load pod. No certificate, private key or production
credential is checked in.

Do not call deleting the Secret, stopping the proxy or changing the proxy
configuration “certificate expiry.” The fault must be an expired X.509
certificate presented during a new TLS handshake, with the proxy process still
running and the Secret still present. The design needs one of:

- a short-lived certificate that naturally reaches `notAfter` during a
  controlled session; or
- a pre-generated certificate whose `notAfter` is already in the past, loaded
  into the running proxy and reloaded without changing connectivity or process
  health.

SC-04 uses a pre-generated leaf whose `notAfter` is already in the past. The
proxy uses the existing `tawira:chaos-local` Node 22 image already loaded in
kind; the live runner records the exact image ID and certificate metadata. The
reload command is `node -e 'process.kill(1,"SIGHUP")'` in the proxy pod. The
proxy keeps the same pod and process while `server.setSecureContext()` loads
the replacement. If the local clock is changed, the entire test bed is affected
and the run is invalid; the runner never changes the clock.

## Control and hypotheses

Use a fresh HTTPS load profile with the same validated-sale and ledger contract
as the other scenarios. Establish a 120-second control with a valid chain and
hostname, then verify the proxy is Running, its backend is reachable and the
client is completing new TLS handshakes. The control must meet the existing
99.5% / p95 1 s / p99 2 s targets before expiry is introduced.

| ID | Prediction | Refuted or unresolved if |
|---|---|---|
| H1 | New HTTPS requests fail certificate validation after `notAfter`, while the proxy and backend remain Running. | The certificate is still valid, the client reuses an existing connection, or the proxy/backend fails for another reason. |
| H2 | Restoring a valid certificate and reloading the proxy restores new handshakes without an app or database restart. | Recovery requires an unrelated process restart, or the chain/hostname remains invalid. |
| H3 | No acknowledged sale is missing and no tag is duplicated across the expiry window. | Ledger reconciliation finds a missing/mismatched UUID or duplicate row. |
| H4 | Existing alerts may identify endpoint or handshake failures differently from application errors. | Record the exact series and whether it distinguishes TLS validation from proxy/backend failure. |

Measure the client failure interval, TLS error class, proxy/backend health,
alert state and recovery after valid-certificate reload. RTO begins only after
the valid certificate is loaded and the proxy reports a successful new
handshake. A browser screenshot is supplementary; the client and proxy logs
are authoritative.

## Entry criteria and safety

The boundary, trusted test CA, HTTPS load profile, certificate-generation method
and reload path are now committed and fixture-tested. The eventual run must use
unique resource names, a local-only hostname, no production credentials and an
attended operator. Abort on any real certificate/key, clock change, proxy restart,
backend fault, missing ledger row, resource pressure or inability to restore a
valid certificate. Delete only the disposable proxy resources after evidence
is copied and redacted.

The fixture checks are:

```bash
node --test tests/sc04-tls.test.mjs
shellcheck scripts/sc04-certificate-expiry.sh
```

The live runner is deliberately separate:

```bash
DB=<verified-supabase-postgres-container> \
LOCAL_PROJECT=<verified-supabase-project-label> \
RUN_ID=sc04b ./scripts/sc04-certificate-expiry.sh --check
DB=<verified-supabase-postgres-container> \
LOCAL_PROJECT=<verified-supabase-project-label> \
RUN_ID=sc04b ./scripts/sc04-certificate-expiry.sh --run
```

It refuses to inject the expiry if the HTTPS control does not meet the
validated-sale and latency gate used by the other scenarios. It preserves the
client log, certificate dates and serials, proxy pod identity before and after
each reload, proxy logs, ledger reconciliation and 30-second recovery windows.

## Result

### sc04a: invalid before certificate reload was verified (2026-11-07)

The 120-second HTTPS control passed, but the runner aborted before measuring the
fault because the proxy was still serving the valid leaf after the Secret update.
The generated expired leaf was validly dated (`notAfter` 2026-11-06), while the
proxy had not yet observed the projected Secret. The guard rejected the run when
the expired-handshake probe returned HTTP 200. No expiry or recovery verdict is
derived from this attempt. The control, certificate metadata and pod identity
are preserved in `measurements/results/sc04a/`; the disposable resources were
cleaned up. The runner now waits for the mounted certificate serial before
reloading and keeps this failed setup attempt separate from the measured run.

### sc04b: measured (2026-11-07, one local run)

The 120-second HTTPS control passed with 627 requests, 100% validated sales,
p95 360 ms and p99 597 ms. The proxy presented a valid serial `1000`, then the
expired serial `1001` (`notAfter` 2026-11-06) after the Secret projection and
`SIGHUP`. The proxy pod remained the same pod with zero container restarts. A
new client handshake failed with `CERT_HAS_EXPIRED`; after the valid serial was
reloaded, a new handshake returned HTTP 200 and the proxy remained running.

| Measure | Observed |
|---|---|
| Requests sent / planned | 1,950 / 1,950 |
| Validated sale successes / database rows | 1,514 / 1,514 |
| Clean certificate failures | 436 (`CERT_HAS_EXPIRED`) |
| Lost responses / acknowledged missing or mismatched / duplicate tags | 0 / 0 / 0 |
| Fault interval | 60 s planned; failures from -3 s to +84 s relative to the recorded fault event |
| Recovery observation | Valid certificate reloaded at 09:29:01Z; no failures after restore |
| Success-ratio RTO | **90 s**, 30 s resolution; complete windows at +90 s and later met the 99.5% target |
| Proxy/backend state | Same pod, zero restarts; upstream Tawira remained outside the fault |
| Alert query | No firing `ALERTS{alertstate="firing"}` or `HighLatencyP99` series in the 09:24–09:32 UTC range |

The `-3 s` first-failure offset reflects the timestamp of the explicit fault
event, which was recorded after the expired probe and reload completed. The
client errors themselves are the authoritative certificate boundary signal;
the proxy log contains the corresponding TLS client resets. No sale was
committed without a validated acknowledgement in this run.

Hypothesis verdicts for this one run:

| ID | Verdict | Evidence and limit |
|---|---|---|
| H1 | Supported | New handshakes failed with `CERT_HAS_EXPIRED` while the proxy pod and Tawira backend stayed Running. One run does not generalize TLS client behaviour. |
| H2 | Supported for this run | A valid leaf and `SIGHUP` restored a new handshake without an app, database or proxy restart; RTO was 90 s. |
| H3 | Supported for this run | 1,514 acknowledged UUIDs matched one ledger row each; 436 clean failures created no ledger row; no lost response or duplicate tag was observed. |
| H4 | Not refuted | Neither alert query returned a series. This is corroboration only, not proof that notification delivery was absent. |

Evidence is preserved in `measurements/results/sc04a/` (invalid setup attempt)
and `measurements/results/sc04b/` (measured run), including the client log,
certificate dates and serials, HTTPS probes, proxy pod identity and log,
reconciliation, recovery windows and Prometheus query ranges.

### Fixture result (2026-11-07)

The proxy fixture completed a trusted HTTPS request, replaced the leaf and
reloaded it with `SIGHUP`, completed a second request, and confirmed the proxy
process ID did not change. This proves the reload mechanism and client trust
path only; it does not prove certificate-expiry behaviour under a Kubernetes
load, a sale outcome or a recovery time.
