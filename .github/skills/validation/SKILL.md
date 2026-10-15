---
name: validation
description: "Use whenever an agent validates code changes in this repository. Run only documented, targeted checks; never deploy or make live model calls unless the task requires it."
user-invocable: false
---

# Validation

Use this procedure whenever validating an implementation or review.

## Commands

Run only checks the repository documents or configures (README, project config). Do not invent tooling; if none exists, report that instead.

Prefer, in order:
1. Targeted tests of pure generation, validation, and tool logic (no live model calls).
2. Type checking and linting where configured.

Do not run deployment commands, and do not make live model or cloud calls unless the task explicitly requires it. Report any check skipped and why.
