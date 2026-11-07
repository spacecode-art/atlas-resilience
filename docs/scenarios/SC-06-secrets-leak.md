# SC-06: Secret leak detection and rotation tabletop

## Status and scope
Designed 2026-11-02. A synthetic local rehearsal (`tabletop-20261107`) passed
on 2026-11-07. No real secret was generated, leaked, revoked or sent to a third
party. The work ran in a disposable local repository with a local regex detector;
never seed a real credential in Atlas history.

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
steps.

## Rehearsal result: `tabletop-20261107`

The disposable fixture detector found one synthetic token in `.env` without
recording its value. `git archive HEAD` contained only the tracked consumer
file, not `.env`. The mock old-consumer probe was denied and the replacement
probe was allowed. The simulated fixture milestones were 1 s to detect, 2 s to
verify archive containment and 3 s to rotate the mock consumer. This is process rehearsal only:
Gitleaks was not invoked, no issuer was contacted and no real secret was
rotated. Evidence is in `measurements/results/tabletop-20261107/sc06-scan.json`
and `events.json`.
