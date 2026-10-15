---
name: code-review
description: >
  Systematically review changes in this repository (Strands-based synthetic
  data generation agent) for functional correctness, traceability, error
  handling, security-sensitive issues, regression risk, and appropriate
  validation.
user-invocable: false
---

# Code review process

Review the requested change, not the entire repository.

Apply [architectural-conventions](../architectural-conventions/SKILL.md) as a lens, including its Strands agent patterns: flag unnecessary abstractions, scope creep, and drift from existing patterns; do not require fixes for pre-existing bugs outside the change.

Check the change against `.github/orchestration/business/decisions.md` and flag any behavior that contradicts or invents a business rule.

1. Understand intended behavior and scope.
2. Inspect the changed code and only relevant surrounding implementation.
3. Verify functional correctness and meaningful failure paths.
4. For agent definition changes, check:
   - system prompt lives in a dedicated versioned file, with clear role, scope, limits, and when to ask or refuse
   - model, region, temperature, and max tokens come from config, not hardcoded
   - single agent unless a decision justifies agents-as-tools, swarm, or graph
   - conversation manager and agent state use is deliberate
5. For tool changes, check:
   - one responsibility per `tool()`, Zod `inputSchema` with described fields, description covering purpose, returns, and failure behavior
   - pure generation/validation logic separated from the tool wrapper
   - Zod input and output schemas (types via `z.infer`); expected failures returned as error tool results with an actionable message, not thrown
   - bounded behavior: record counts, payload sizes, tool-call counts
6. For traceability, check:
   - OpenTelemetry tracing and SDK hook callbacks cover the new tool or boundary
   - one correlation ID flows from API request through agent, tools, logs, and response
   - structured logging only; no `console.log`, no secrets, no full generated payloads at info level
   - seed is accepted and recorded so output is reproducible
7. For error states, check:
   - throttling, timeouts, max-tokens, and context-window-overflow errors handled at the orchestration boundary with bounded retries and backoff
   - API errors map to explicit status codes and a stable body with the correlation ID; no stack traces or prompts leaked
   - generated data validated against schema and cross-entity references; partial results never returned silently
8. For API and data contract changes, check backwards compatibility of response schemas, error bodies, and field semantics.
9. For security, check:
   - no real personal data; synthetic identifiers use reserved ranges and domains
   - user input and tool output treated as untrusted (prompt injection cannot alter tool permissions, system prompt, or limits)
   - secrets stay out of code, prompts, and logs; least privilege for any cloud access
   - authentication, authorization, or public exposure changes are called out explicitly
10. Assess tests and validation proportional to the change risk. Tool and generation logic should be testable without a model.
11. Look for scope creep, unnecessary abstractions, and regressions.
12. Review architecture and module boundaries: code should be split at
    reasonable ownership boundaries, and important or risky functionality
    should be isolated enough to be changed, tested, and reviewed safely.

Do not perform irrelevant review categories.
Do not nitpick formatting handled by automated tooling.
Review comment quality as part of maintainability: comments should document
non-obvious contracts, invariants, operational constraints, or future-facing
rationale. Flag comments that merely restate the code, narrate control flow,
or explain why a change was made when that context is not important for future
maintenance.

## Findings

BLOCKING:
Broken functionality, untraceable or unbounded tool execution, data/security
issue (including real-looking personal data or secret leakage), incorrect
model/provider integration, or serious backwards incompatibility.

IMPORTANT:
Meaningful correctness, reliability, error-handling, traceability, or
maintainability issue that should be fixed before merge.

MINOR:
Useful non-blocking improvement, including noisy comments or modest
architectural decomposition concerns. Do not downgrade architectural issues
that create functional, security, or significant regression risk.

For each finding include:
- severity
- file/code location
- problem
- why it matters
- smallest reasonable fix

Finish with:
- READY
- READY WITH MINOR FINDINGS
- CHANGES REQUIRED