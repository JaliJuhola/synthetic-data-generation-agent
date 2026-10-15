# Recommendation Agent Logging

## Summary
Add safe lifecycle tracing to the recommendation agent, with compact JSON console output by default and an injectable logger for alternate output or no-op use. Preserve `RunTraceSink` independently for report aggregation.

## Assumptions
- The logger receives only the existing narrow trace event fields; prompts, payloads, provider bodies, credentials, tool arguments, and tool results are never logged.
- The existing recommendation hooks already produce model and tool lifecycle events, so hook mechanics do not need to change.

## Cross-cutting contracts
- Each log record is one-line structured JSON containing only safe fields available from the trace event: `runId`, `event`, safe agent/tool name, `durationMs`, `outcome`, and token usage when available. Do not add payload-bearing fields.
- The per-agent logger defaults to console output, can be explicitly replaced or disabled, and operates independently of `RunTraceSink` report aggregation.

## Non-goals
- No changes to other agents, CLI configuration, recommendation behavior, hook mechanics, or the trace report contract.
- No logging framework or external dependency.

## Security-sensitive
- Recommendation-agent logging is security-sensitive because trace events must not expose prompts, tool arguments/results, campaign/product/persona payloads, provider request/response bodies, API keys, or other secrets.

## Task DAG
| ID | Owner | Goal | Depends on | Status |
|----|-------|------|------------|--------|
| T1 | synthetic-data-agent | Add safe, injectable recommendation-agent lifecycle logging while preserving report tracing | - | done |

### T1: Add recommendation-agent logger
- In scope: `src/agents/recommendation/logger.ts`, `src/agents/recommendation/index.ts`, `src/agents/recommendation/internal.ts`, and focused recommendation-agent tests.
- Out of scope: Other agents, CLI changes, recommendation behavior, hook mechanics, trace report contract, logging frameworks, and external dependencies.
- Acceptance criteria:
  - A small logger interface/type and default console implementation emit compact one-line JSON lifecycle events.
  - `RecommendationAgentOptions` supports an injected logger, defaults to the console logger, and allows an explicit no-op or alternate logger.
  - Sanitized events are routed to both the logger and the existing `RunTraceSink`, without changing report aggregation behavior.
  - Tests cover run/model/tool event coverage, custom logger injection, and absence of sensitive payload fields.
- Validation: `npm run typecheck` and `npm test -- src/agents/recommendation/recommendation.test.ts`; no live calls.

## Status
- Current phase: done
- Notes: T1 and follow-up R1 complete; typecheck and focused tests pass. Feature reviewer confirmed READY.

## Discoveries & follow-ups
- Logger receives only allowlisted `RunTraceEvent` fields. Logger exceptions are swallowed so logging cannot interrupt recommendation execution; `RunTraceSink` remains independent.

## Review findings
- R1 IMPORTANT (`src/agents/recommendation/hooks.ts`, logger boundary): tool names originate from model tool-use events; field allowlisting alone did not prevent an unexpected tool name from reaching console logs. Console output now omits unregistered tool names while the `RunTraceSink` still receives the original event. Added regression coverage; typecheck and focused recommendation tests passed. Re-review confirmed fixed.