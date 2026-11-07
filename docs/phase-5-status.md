# Phase 5 progress against the Atlas Path

Reviewed 2026-11-02 against *The Atlas Path — Zero-Cost Execution Plan (v2)*,
Phase 5 (Resilience). This is a deliverable checklist, not a completion claim.

| Roadmap deliverable | Current evidence | Remaining work |
|---|---|---|
| AZ failure design | SC-01 design, H1–H6 verdicts, one valid local run | Optional ADR-0005 capacity comparison is separate from the measured baseline. |
| DB failure design | SC-02 hypotheses, runner, `sc02smk9` smoke and `sc02b` | One valid local outage run: 510 s fault-relative RTO, 30 s DB-ready-relative RTO, one lost response; repeat and investigate retry safety. |
| DNS failure design | [`SC-03`](scenarios/SC-03-dns-failure.md), guarded runner, readiness check and `sc03b` | Repeat/extend the observation and investigate lost responses; no broad DNS-availability claim. |
| Certificate-expiry design | [`SC-04`](scenarios/SC-04-certificate-expiry.md) boundary, disposable proxy and reload fixture | `sc04b`: one measured run, 90 s HTTPS recovery RTO; repeat for confidence. |
| IAM compromise design | SC-05 tabletop document | Rehearsal is optional evidence; no real revocation claimed. |
| Secrets-leak design | SC-06 tabletop document | Rehearsal is optional evidence; no real credential rotation claimed. |
| Local chaos exercise | Chaos Mesh smoke and namespace-isolation evidence; SC-01 host-side worker fault | Record exact tooling/runtime for each later fault. |
| Measured RTO/RPO | `sc01c3`: 60 s success RTO; `sc02b`: 510 s fault-relative / 30 s DB-ready-relative RTO | Repeat SC-02 and resolve the one lost response before making an RPO or idempotency claim; no volume-loss RPO claim. |
| Recorded Game Day and postmortem | Plan/template; SC-01 experiment postmortem | Actual observed response, recording, restored environment and a Game Day postmortem. Not executed. |

SC-07 is an additional repo objective, not a seventh required live experiment
in the Phase 5 roadmap. AWS reference Terraform and a cloud burst demo are also
separate scope; do not silently make them prerequisites for local Phase 5 proof.

## Next complete piece of work
SC-02 now has a checked-in runner with explicit local DB identity, a validated-sale
control gate, bounded outage/restore, preserved logs, strict measurement checks,
both recovery anchors and UUID ledger reconciliation. On 2026-11-07, the live
read-only preflight and `sc02smk9` smoke passed, followed by one complete outage
run (`sc02b`). It measured 510 s from fault to a complete recovery window and
30 s from confirmed DB readiness, with one lost response and no duplicate or
unmatched database tag. The invalid interrupted attempt (`sc02a`) remains
preserved. See the [runbook](runbooks/SC-02-database-failure.md) for the repeat
run and the required retry/idempotency investigation.

Then repeat or extend the DNS observation as scheduled. SC-04 now has one
measured expiry run; repeat it for confidence before making a general TLS
availability claim. Review the
Game Day entry conditions, execute/record the selected local exercises and write
the resulting postmortem. A plan or a passing YAML parser is not that evidence.

## Evidence discipline
- State whether a statement is a design, fixture test, inference or live observation.
- Preserve original targets and invalid runs; report sample size and resolution.
- A validated sale UUID must match a ledger row; HTTP 200 is insufficient.
- Reject incomplete or inconsistent client data instead of deriving a reassuring RTO.
- Every running fault has a tested restoration path and a clearly named operator.
- Keep source/image/version provenance and exact commands; no untracked session-only
  supervisor should be required to reproduce a claimed result.
