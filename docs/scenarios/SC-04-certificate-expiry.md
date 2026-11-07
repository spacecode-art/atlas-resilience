# SC-04: certificate expiry at a local TLS boundary

## Status

Design gap recorded 2026-11-07. **Not ready to run.** The current Tawira
Service and load generator use plain HTTP inside kind; there is no TLS
termination or cert-manager resource in this repository. No certificate
expiry result is claimed.

## Boundary decision required before implementation

Add a disposable, in-cluster TLS reverse proxy in front of the Tawira Service,
with a dedicated DNS name and a test CA trusted only by the load generator.
The proxy must forward to `tawira:3000`, expose a separate HTTPS endpoint and
leave the existing HTTP SC-01/SC-02 path unchanged. The certificate and key
must be generated for the test session or stored as a deliberately disposable
Kubernetes Secret; no hosted or production certificate is allowed.

Do not call deleting the Secret, stopping the proxy or changing the proxy
configuration “certificate expiry.” The fault must be an expired X.509
certificate presented during a new TLS handshake, with the proxy process still
running and the Secret still present. The design needs one of:

- a short-lived certificate that naturally reaches `notAfter` during a
  controlled session; or
- a pre-generated certificate whose `notAfter` is already in the past, loaded
  into the running proxy and reloaded without changing connectivity or process
  health.

The chosen method, trust policy, proxy image digest and reload command must be
recorded before the experiment. If the local clock is changed, the entire test
bed is affected and the run is invalid; do not use clock changes as a shortcut.

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

The scenario is blocked until the TLS boundary, trusted test CA, HTTPS load
profile, certificate-generation method and reload path are committed and
fixture-tested. The eventual run must use a fresh namespace or unique resource
names, a local-only hostname, no production credentials and an attended
operator. Abort on any real certificate/key, clock change, proxy restart,
backend fault, missing ledger row, resource pressure or inability to restore a
valid certificate. Delete only the disposable proxy resources after evidence
is copied and redacted.

## Result

No live result, alert timing, RTO, RPO or hypothesis verdict exists. The next
implementation step is a separate TLS boundary decision and fixture; it is not
safe to label the current HTTP deployment a certificate-expiry experiment.
