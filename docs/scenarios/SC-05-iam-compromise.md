# SC-05: Compromised IAM identity tabletop

## Status and scope
Designed 2026-11-02, **not rehearsed**. No account changes, credential revocation
or live AWS calls were made. Use a fictional Atlas dev identity and isolated
MiniStack only. MiniStack API behavior does not prove AWS IAM enforcement.

## Hypothesis and objective
A responder can identify an exposed test principal, contain its usable test
credentials, preserve an audit trail and restore the intended least-privilege
access within 15 minutes of the tabletop trigger. Detection target: identify
the principal and affected test account within 5 minutes. These are proposed
drill targets, not measured MTTD/RTO. RPO is not a stateless-sale metric here;
record potentially exposed resources and audit completeness separately.

## Steady state and blast radius
Start from an inventoried test principal with documented expected permissions,
a local audit-log fixture and a known-good synthetic action. Record the local
emulator endpoint explicitly. Keep production profiles/credentials out of the
session; no organization SCPs, SSO users or real service principals are changed.

## Injects and response

| Inject | Responder action | Evidence required |
|---|---|---|
| T+0 fictional alert: test access key used unexpectedly | Identify principal, account, key fingerprint and expected owner; start timeline. | Sanitized inventory and timestamps; no full key. |
| T+3 fixture shows unexpected API action | Scope reachable resources, preserve original audit fixture, distinguish facts from assumptions. | Event IDs, affected-resource inventory, original fixture hash. |
| T+5 key also found in a local job definition | Containment rehearsal: disable the test key, remove emulator-only grants, stop its synthetic consumer. | Local API result and a denial/negative probe, noting emulator limits. |
| T+8 service owner requests restoration | Issue a separate least-privilege test identity; replace the consumer credential; verify expected action and forbidden action. | Positive/negative checks and credential-replacement record. |
| T+12 facilitator asks about existing sessions | Document how real STS/session revocation would be handled and what local emulation cannot test. | Explicit untested steps, no claim that disabling a key revokes every session. |

## Abort and closure
Abort immediately if a CLI points at real AWS, contains production credentials,
or any instruction affects a non-test identity. Do not continue to achieve a
timing target. Roll back the emulator fixture and remove disposable test keys.

Use a facilitator, responder and recorder (one person can simulate roles).
Mark each hypothesis supported/refuted/unresolved only after rehearsal, attach
sanitized command output, record gaps and assign follow-up ownership. No elapsed
time, successful containment or audit result is claimed in this design.
