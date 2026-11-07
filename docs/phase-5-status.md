# Phase 5 progress against the Atlas Path

Reviewed 2026-11-07 against *The Atlas Path — Zero-Cost Execution Plan (v2)*,
Phase 5 (Resilience). This is a deliverable checklist, not a completion claim.

| Roadmap deliverable | Current evidence | Remaining work |
|---|---|---|
| AZ failure design | SC-01 design, H1–H6 verdicts, one valid local run | Optional ADR-0005 capacity comparison is separate from the measured baseline. |
| DB failure design | SC-02 hypotheses, runner, `sc02smk9`/`sc02smk10` smoke, `sc02b`, `sc02c` and `sc02idem1` | Two valid local outage runs: both 510 s fault-relative and 30 s DB-ready-relative RTO; `sc02b` had one lost response and `sc02c` had zero; targeted replay passed. |
| DNS failure design | [`SC-03`](scenarios/SC-03-dns-failure.md), guarded runner, readiness check and `sc03b`/`sc03c` | Two valid 90 s observations; 17 and 25 lost responses keep retry safety unresolved and no broad DNS-availability claim is made. |
| Certificate-expiry design | [`SC-04`](scenarios/SC-04-certificate-expiry.md) boundary, disposable proxy and reload fixture | `sc04b`/`sc04c`: two measured runs, each 90 s HTTPS recovery RTO and zero lost responses. |
| IAM compromise design | SC-05 tabletop document and `tabletop-20261107` synthetic rehearsal | Rehearsal passed the local state-machine checks; no real revocation or AWS IAM enforcement claimed. |
| Secrets-leak design | SC-06 tabletop document and `tabletop-20261107` synthetic rehearsal | Rehearsal passed detector/archive/consumer checks; no Gitleaks rule-set coverage or real credential rotation claimed. |
| Local chaos exercise | Chaos Mesh smoke and namespace-isolation evidence; SC-01 host-side worker fault | Record exact tooling/runtime for each later fault. |
| Measured RTO/RPO | `sc01c3`: 60 s; `sc02b`/`sc02c`: 510 s fault-relative and 30 s DB-ready-relative; `sc03b`/`sc03c`: 90 s; `sc04b`/`sc04c`: 90 s; `sc02idem1`: replay safety observation | Repeats improve confidence but remain local samples. SC-03 lost responses (17, 25) and the SC-02 first-run loss keep volume-loss RPO and universal retry safety unresolved. |
| Recorded Game Day and postmortem | Plan/template; SC-01 experiment postmortem | Actual observed response, recording, restored environment and a Game Day postmortem. Not executed. |

SC-07 is an additional repo objective, not a seventh required live experiment
in the Phase 5 roadmap. AWS reference Terraform and a cloud burst demo are also
separate scope; do not silently make them prerequisites for local Phase 5 proof.

## Next complete piece of work
The live repeat set is now recorded. SC-02 has two complete database outage runs,
with identical 510 s fault-relative and 30 s DB-ready-relative recovery anchors;
`sc02b` recorded one lost response and `sc02c` recorded none. SC-03 has two
complete DNS runs at 90 s recovery, with 17 and 25 lost responses. SC-04 has two
complete certificate-expiry runs at 90 s recovery with zero lost responses. The
invalid attempts remain preserved, and the alert-range exports show no firing
series for the recorded SC-02 repeat.

The remaining Phase 5 work is deliberately separate: execute and record the
Game Day, validate F-01 and the ADR-0005 placement comparison, and write the
resulting postmortem. The SC-05/SC-06 rehearsal is now recorded, but its output
must not be presented as live IAM, secrets-rotation or independent-zone proof.

## Evidence discipline
- State whether a statement is a design, fixture test, inference or live observation.
- Preserve original targets and invalid runs; report sample size and resolution.
- A validated sale UUID must match a ledger row; HTTP 200 is insufficient.
- Reject incomplete or inconsistent client data instead of deriving a reassuring RTO.
- Every running fault has a tested restoration path and a clearly named operator.
- Keep source/image/version provenance and exact commands; no untracked session-only
  supervisor should be required to reproduce a claimed result.
