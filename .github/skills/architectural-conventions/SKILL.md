---
name: architectural-conventions
description: "Shared architectural rules for planning, implementing, and reviewing changes in this repo. Enforces scope discipline, simplicity, and existing conventions."
user-invocable: false
---

# Architectural conventions

Apply these rules whenever planning, implementing, or reviewing a change.

## Keep it simple

- Prefer the smallest coherent change that satisfies the requirement.
- Do not add abstractions, layers, config knobs, or generic helpers for speculative future needs.
- Only introduce a new module, package, or seam when it makes risky or reused functionality easier to change, test, or review.
- If a simpler shape exists (fewer files, fewer indirections, inline over helper), prefer it unless a concrete reason forbids it.

## Stay in scope

- Do not fix pre-existing bugs, style issues, or dead code outside the task's stated scope. Report them as discoveries or follow-ups.
- Do not opportunistically refactor untouched code, rename symbols, or reformat files.
- Small adjacent edits required to keep the implementation coherent are allowed; anything larger becomes a discovery.

## Follow existing patterns

- Match the closest existing pattern for integrations, error handling, logging, config, and module layout before inventing a new one.
- Preserve module ownership boundaries: `packages/data-generation` owns report data, `infra/aws` owns CDK, `apps/processor` owns Lambda entry points.
- Preserve existing contracts, naming, and environment/stage behavior unless the task explicitly changes them.

## Strands agent patterns

1. **Start with one agent and tools.** Add agents-as-tools, swarm, or graph only when a decision or requirement needs it.
2. **Keep the system prompt in a dedicated, versioned file.** State role, scope, limits, and when to ask or refuse. No inline prompt strings in code.
3. **Configure the model explicitly.** Provider, model ID, region, temperature, and max tokens come from typed config or environment, never from tool or API code.
4. **One responsibility per tool.** Use the SDK `tool()` helper with a Zod `inputSchema` (`.describe()` on fields) and a description covering purpose, returns, and failure behavior, because the model reads it.
5. **Separate pure logic from the tool wrapper.** Generation and validation logic is a plain function that is testable without a model; the tool only adapts inputs and outputs.
6. **Use Zod for inputs, outputs, and the final response.** Use structured output so results are validated schemas, never raw model text.
7. **Return errors as tool results.** Expected failures return `{"status": "error", "content": [...]}` with an actionable message so the model can recover. Raise only for programmer errors.
8. **Trace every tool call.** Enable OpenTelemetry, register SDK hook callbacks for before/after tool and model events, and carry one correlation (run) ID through the run, tools, logs, and output.
9. **Bound everything.** Limit tool calls, record counts, payload sizes, retries (with backoff), and conversation context via a conversation manager. Handle throttling, max-tokens, and context-window-overflow errors at the orchestration boundary.
10. **Treat inputs and tool outputs as untrusted.** Validate API input, keep secrets out of prompts and logs, and never let user text change tool permissions or the system prompt. Make generation reproducible with a recorded seed.

## Comments and docs

- Write comments only for information the code cannot express: non-obvious contracts, invariants, operational constraints, future-facing rationale.
- Do not narrate control flow, restate the next line, or explain the diff to reviewers.

## Review lens

When reviewing, flag as findings:
- Unnecessary abstractions, layers, or configurability introduced by the change.
- Scope creep, including fixes to unrelated pre-existing bugs.
- Deviations from existing repo patterns without a stated reason.
