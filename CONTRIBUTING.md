# Contributing

Thank you for your interest in contributing to Atlas Resilience.

## Development Workflow

1. Create a feature branch from `main`.
2. Make focused, well-documented changes.
3. Before committing a chaos experiment, confirm it states a hypothesis,
   a steady state, a blast radius, and an abort condition (the template
   in `docs/scenarios/`).
4. Open a Pull Request with a clear description.

## Anonymization Requirement

Per [ADR-0003](docs/adr/ADR-0003-target-workload.md), the target
workload is Tawira, a private application. Nothing committed here may
identify it or its backing project. Specifically:

- Use the generic service name `atlas-demo-api`.
- Command output captured as evidence (`docker ps`, `supabase status`,
  logs) can contain a hosted-project reference in container or network
  names. Redact it before committing.
- Never commit `.env` files, API keys, or webhook URLs.

## Evidence Standards

- Label every measurement with the environment it came from. Results
  from a local kind cluster are not AWS service timings.
- A single run is an observation, not a result. State the run count.
- Write down findings that contradict the hypothesis. They are
  evidence, not embarrassment.

## Commit Messages

Follow a clear, descriptive style.

Examples:

```text
feat(chaos): add PodChaos experiment for SC-01 zone failure
docs(adr): add ADR-0004 for health endpoint decision
fix(target): correct readiness probe port
```

## Code Standards

- Write clear documentation.
- Keep experiments reproducible: one command, pinned versions.
- Prefer small, focused commits.
- Avoid committing secrets, `.env` files, or Terraform state files.
- No `apply` against real AWS from CI; the `terraform/` reference design is plan-only.