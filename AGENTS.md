# Project chart-performance preference

For chart rendering, transport, switching or simulation-scheduling work, read
`docs/chart-performance-checklist.md` and apply its six checks in proportion to
the change. The user explicitly wants this checklist reused for future charts.
Preserve complete tick/order/settlement behavior. Distinguish automated DOM and
server benchmarks from actual browser frame-rate measurements.

# Deployment policy

Always deploy through GitHub and the repository's GitHub Actions workflow.
Commit and push changes, then use a pull request into `main` so the normal
validation and deployment pipeline applies. Never copy source to production
or build/restart production services directly over SSH.
