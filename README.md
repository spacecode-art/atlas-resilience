# atlas-resilience

> Phase 5 of the Atlas Path. Proving systems fail well, not just run well.
>
> **Status: in progress.** Environment spike under way (see ADR-0003). Scenario results are added as each one is measured.

## Problem Statement
<!-- Why resilience is a design property, not an ops afterthought -->

## Scope: Designed & Validated vs Live Demo
<!-- Split per Atlas convention -->

## Architecture Diagram
<!-- docs/architecture/overview.md -->

## Failure Scenarios
| ID | Scenario | Method | Doc |
|----|----------|--------|-----|
| SC-01 | AZ failure | Zone-labeled kind nodes | docs/scenarios/SC-01-az-failure.md |
| SC-02 | DB failure | Chaos Mesh PodChaos/NetworkChaos | docs/scenarios/SC-02-db-failure.md |
| SC-03 | DNS failure | Chaos Mesh DNSChaos | docs/scenarios/SC-03-dns-failure.md |
| SC-04 | Cert expiration | cert-manager short-lived certs | docs/scenarios/SC-04-cert-expiration.md |
| SC-05 | IAM compromise | Tabletop + MiniStack | docs/scenarios/SC-05-iam-compromise.md |
| SC-06 | Secrets leak | Tabletop + Gitleaks | docs/scenarios/SC-06-secrets-leak.md |

## Design Decisions (ADR)
## Threat Model
## Technology Choices (with tradeoffs)
## Cost Model (designed cost, $0 spent)
## Deployment Guide
## CI/CD
## Security Review
## Testing Strategy
## Monitoring
## Incident Runbook
## Game Day
## Postmortem Example
## RTO/RPO Results
## Future Roadmap
## Demo Video
