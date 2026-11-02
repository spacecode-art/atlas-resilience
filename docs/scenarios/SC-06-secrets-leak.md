# SC-06: Secret leak detection and rotation tabletop

## Status and scope
Designed 2026-11-02, **not rehearsed**. No real secret was generated, leaked,
revoked or sent to a third party. Work in a disposable local repository with a
synthetic detector fixture; never seed a real credential in Atlas history.

## Hypothesis and targets
The existing secrets scan rejects a deliberately synthetic matching fixture
within 5 minutes of scan start. A responder can identify every simulated
consumer, rehearse revocation/replacement and verify the replacement within
15 minutes of the trigger. Treat a real exposed credential as compromised:
removing a file or rewriting history alone does not restore secrecy. These
are proposed drill times; confidentiality loss has no meaningful sale RPO.

## Control and blast radius
A clean disposable fixture passes the same pinned Gitleaks rule set as CI.
Record scanner version/config and fixture hash. The only injected failure is
a synthetic matching token in that disposable fixture, never in this repo,
a hosted project, a remote branch, a CI variable or a notification channel.
Generate it at rehearsal time and redact scan output. Detector coverage for a
fixture does not prove coverage for every Supabase or Cloudflare credential.

## Injects and actions

| Inject | Response | Evidence |
|---|---|---|
| T+0 fixture scan fails | Confirm detector/rule, redact token value, identify simulated issuer and affected repo/consumers. | Rule ID, exit code, scan timestamps. |
| T+3 fixture says CI and a Kubernetes Secret consume it | Inventory both, preserve the alert/audit data, rehearse revocation before cleanup. | Consumer map and mock revocation record; no real API calls. |
| T+6 one consumer has a stale copy | Rehearse replacement in the disposable consumers and verify positive and negative probes. | Replacement works; simulated old token denied. |
| T+10 leaked archive appears | Inventory ignored files in a disposable copy; demonstrate `git archive HEAD` exports only tracked content. | File listing excludes `.env`, tokens and private project IDs. |
| T+12 facilitator asks about publication | Assess simulated exposure window, logs and artifacts; name owners and notification procedure. | Written response decision; no messages sent in the tabletop. |

## Abort and closure
Stop if a real token, production endpoint, non-test consumer or external message
is involved. Never print full secrets, including in screen recordings. Remove
the disposable fixture and record cleanup. For a real incident use the issuer's
current revocation procedure and explicit notification authorization; this
design is not evidence that a production credential was rotated.

Rehearsal record must include control/negative scan results, detection and
containment durations, every consumer, cleanup and unresolved issuer-specific
steps. All results remain unmeasured until that record exists.
