# SC-01 review follow-up validation — 2026-11-02

These checks validate the review changes. They are not a new fault experiment.
The original `sc01c3` artifacts are preserved separately and predate this patch.

| Check | Observed result |
|---|---|
| `node --test tests/sc01-harness.test.mjs` | 9/9 passing; fixture responses, stubbed node readiness/IP and analyzer failure/recovery cases. |
| `shellcheck scripts/sc01-zone-loss.sh scripts/check-pod-cidrs.sh` | Passed. |
| Shell/Node syntax | Passed for the harness, generator, analyzer and prepared SC-02 Bash block. |
| YAML and local Markdown links/fences | Parsed/checked; no broken local links in README/docs. |
| Kubernetes server dry-run | Namespace/Deployment/Service, renamed load Job and ADR-0005 candidate accepted; nothing applied. |
| Current image identity | `tawira:chaos-local`, SHA-256 `4ac9bec44e6ffd2ba4cbccb189890324456ba48cff36b48c39c00cf28a3f4205`, image USER `tawira`, UID 100/GID 101. |
| Restricted Node start | UID 100/GID 101, all capabilities dropped, no-new-privileges; bound container port 3000 and exited successfully. This is not an application rollout/sale smoke under Kubernetes seccomp. |
| Pinned Gitleaks staged-export scan | v8.24.3, image digest `sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055`, no leaks found; exported source/data mounted read-only with container networking disabled. |
| Export boundary | No `.env` files or workspace archives in the tracked/staged export; incomplete live snapshot excluded. |
| `git diff --cached --check` | Passed; two verbatim Helm/psql capture files have explicit whitespace attributes. |

Raw evidence was not rewritten to remove capture whitespace. New documents
separate observations, inferences and proposed changes. Cloudflare variables
are optional and empty in the example; only disposable scoped test tokens are
permitted by the documented workflow. Recheck image numeric IDs after changing
its USER/base image.

No new worker/database fault, IAM/key change, external notification, tabletop
rehearsal or Game Day recording occurred in this review pass. Security settings
and the ADR-0005 comparison are committed proposals, not deployed changes.
SC-02 is prepared for a separate dedicated run.
