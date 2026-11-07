# Atlas resilience Game Day plan

## Status
Prepared 2026-11-02. Date and participants not scheduled. **Not executed or
recorded.** SC-01 evidence is one prior experiment, not a Game Day recording.
Use [the record template](record-template.md) during a future session.

## Objectives and roles
Demonstrate trustworthy sale outcomes and recovery evidence, distinguish
service recovery from capacity recovery, and exercise containment reasoning.
Assign a facilitator (go/no-go and injects), operator (fault/restore), observer
(client/telemetry/ledger) and recorder before starting. Solo execution is
possible only sequentially with active observation and an immediately available
abort path; never describe simulated roles as separate participants.

## Prerequisites and entry decision
- Dedicated local test environment; no production endpoints, identities or data.
- Healthy host, current matching app/database, authenticated 20-product check,
  verified 150-sale smoke, three replicas, valid pod CIDRs and working telemetry.
- Fresh run IDs, prewritten hypotheses/targets, recorded versions and manifest
  choice, tested restore commands, sufficient stock and an available observer.
- SC-02 procedure reviewed separately; F-01 open detection gap explicitly noted.
- SC-05/SC-06 use synthetic fixtures and an emulator; no real credentials.
- Recording destination and redaction review chosen. Do not record terminal
  secrets, private project references, tokens or webhook URLs. No automatic
  publishing/upload or third-party notification is part of this plan.

## Proposed sequence (relative times are a plan)

| Slot | Activity | Exit evidence |
|---|---|---|
| 00:00–00:15 | Roles, scope, restore rehearsal, entry checks | Signed local go/no-go record, smoke ledger and versions. |
| 00:15–00:40 | One preselected SC-01 baseline or ADR-0005 comparison | New complete run, explicit manifest, verdicts and ledger; restore verified. |
| 00:40–00:50 | Reset, resource/stock/alert checks | Healthy baseline re-established; no overlap with next fault. |
| 00:50–01:20 | SC-02, only after its independent control passes | DB-ready anchor, complete recovery observation, client/alert/ledger evidence. |
| 01:20–01:35 | SC-05 tabletop | Inventory, containment reasoning, emulator limits and elapsed times. |
| 01:35–01:50 | SC-06 tabletop | Synthetic scan results, mock consumer rotation and archive checks. |
| 01:50–02:10 | Restore, debrief, recording redaction | All services healthy; findings and owners; recording reviewed before sharing. |

Durations are estimates, not deadlines to truncate recovery observation. Pause
or cancel the next inject if the previous scenario has not recovered. Live
faults follow their scenario-specific manual abort rules; the facilitator can
stop the session at any time. A failed control is a stop decision, not a reason
to weaken a target. Do not run overlapping worker/database failures.

## Completion and recording
Save a local recording if the operator chooses a tool, with a clock visible and
fixed dashboard time range. Mark recording gaps or missing audio rather than
reconstructing them. Keep the raw recording private until reviewed for secrets;
store a redacted link and timestamps in the record only after a real recording
exists. Commit sanitized textual evidence and postmortem with measured verdicts,
remaining gaps and follow-up owners. No recording artifact exists yet.
