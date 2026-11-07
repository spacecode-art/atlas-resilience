# Phase 5 progress against the Atlas Path

Reviewed 2026-11-02 against *The Atlas Path — Zero-Cost Execution Plan (v2)*,
Phase 5 (Resilience). This is a deliverable checklist, not a completion claim.

| Roadmap deliverable | Current evidence | Remaining work |
|---|---|---|
| AZ failure design | SC-01 design, H1–H6 verdicts, one valid local run | Optional ADR-0005 capacity comparison is separate from the measured baseline. |
| DB failure design | SC-02 hypotheses, runner and `sc02smk7` smoke | Read-only preflight and 150-sale smoke passed on 2026-11-07; the database outage remains unrun. |
| DNS failure design | [`SC-03`](scenarios/SC-03-dns-failure.md), guarded runner, readiness check and `sc03b` | Repeat/extend the observation and investigate lost responses; no broad DNS-availability claim. |
| Certificate-expiry design | [`SC-04`](scenarios/SC-04-certificate-expiry.md) boundary decision | Build and fixture-test a disposable TLS termination path; current HTTP deployment is not eligible. |
| IAM compromise design | SC-05 tabletop document | Rehearsal is optional evidence; no real revocation claimed. |
| Secrets-leak design | SC-06 tabletop document | Rehearsal is optional evidence; no real credential rotation claimed. |
| Local chaos exercise | Chaos Mesh smoke and namespace-isolation evidence; SC-01 host-side worker fault | Record exact tooling/runtime for each later fault. |
| Measured RTO/RPO | `sc01c3`: 60 s success RTO; 5,480 matching acknowledgements, no duplicates/lost responses | Separate DB-ready and fault anchors for SC-02; no volume-loss RPO claim. |
| Recorded Game Day and postmortem | Plan/template; SC-01 experiment postmortem | Actual observed response, recording, restored environment and a Game Day postmortem. Not executed. |

SC-07 is an additional repo objective, not a seventh required live experiment
in the Phase 5 roadmap. AWS reference Terraform and a cloud burst demo are also
separate scope; do not silently make them prerequisites for local Phase 5 proof.

## Next complete piece of work
SC-02 now has a checked-in runner with explicit local DB identity, a validated-sale
control gate, bounded outage/restore, preserved logs, strict measurement checks,
both recovery anchors and UUID ledger reconciliation. On 2026-11-07, the live
read-only preflight passed and `sc02smk7` produced 150/150 clean, ledger-matched
sales. The database outage remains unrun. See the [runbook](runbooks/SC-02-database-failure.md)
for the separately scheduled fault run.

Then fixture-test and execute the DNS scenario. Complete the certificate
boundary before attempting its scenario. Review the
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
