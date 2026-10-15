# Generation Console Tracing

## Summary
Print safe lifecycle trace events to the console while `generate` is running, so users can see progress before completion. Retain current report event aggregation and CLI completion output, and support no-op or custom logger injection for embedding and tests. Reuse the shared logger for recommendation without duplicate lifecycle output.

## Assumptions
- Catalog/persona and performance hooks already emit the run, model, and tool lifecycle events required; no hook or generation behavior changes are needed.
- Existing recommendation logging should remain enabled once its logger is consolidated onto the shared abstraction.
- Logging remains local and dependency-free; no external logging framework or CLI configuration is introduced.

## Cross-cutting contracts
- A shared trace logger accepts only a safe projection of a `RunTraceEvent`. Console records are one-line JSON and may contain only lifecycle event, run ID, agent name, registered tool name, duration, outcome, and token usage when available.
- Prompts, tool arguments/results, dataset records, provider requests/responses, credentials, and secrets are never passed to or emitted by the logger.
- Tool names are checked against the relevant registered-tool allowlist before console logging. Unknown names are omitted from logs, while the `RunTraceSink` receives every original event unchanged.
- Console logging is the default; callers can inject a custom or no-op logger. Logger exceptions are nonfatal and do not alter agent execution or report aggregation.
- Generation and recommendation each emit their lifecycle events once. Generation tracing continues to collect the same full events for JSON reports; recommendation does not gain a second logging path.

## Non-goals
- Changes to generation or recommendation business behavior, prompts, schemas, model/tool execution, hook mechanics, CLI final completion text, JSON report statistics, or report event semantics.
- Live Azure calls, deployment, new logging dependencies, or broader observability/configuration work.

## Security-sensitive
- Lifecycle console output is security-sensitive because trace events may contain untrusted or payload-bearing values. Enforce the safe field allowlist, registered-tool-name filtering, and independent unmodified report-sink handling at the logger boundary.

## Task DAG
| ID | Owner | Goal | Depends on | Status |
|----|-------|------|------------|--------|
| T1 | implementer | Define the shared safe trace-logger interface and console/no-op implementations | - | done |
| T2 | implementer | Wire generation lifecycle events to the shared logger while preserving report tracing | T1 | done |
| T3 | synthetic-data-agent | Migrate recommendation logging onto the shared trace logger without duplicate output | T1 | done |

### T1: Define shared trace logger contract
- In scope: shared trace logger module under `src/shared/`; its focused offline tests.
- Out of scope: Agent wiring, CLI changes, report aggregation, recommendation behavior, and logging dependencies.
- Acceptance criteria:
  - The shared interface supports default console, no-op, and custom logger implementations without exposing event payload fields.
  - The shared console logger/factory accepts registered tool names as an allowlist; console serialization allows only the cross-cutting safe fields, emits one-line JSON, and omits unknown tool names.
  - Logger failures can be isolated from application behavior by callers.
- Validation: `npm run typecheck` and `npm test -- src/shared/logger.test.ts`.

### T2: Add generation lifecycle console tracing
- In scope: `src/orchestration.ts`, `src/orchestration.test.ts`, and the minimal generation-agent registration metadata needed to filter tool names.
- Out of scope: Recommendation logger migration, lifecycle hook behavior, generation outputs, final CLI output, and report contract changes.
- Acceptance criteria:
  - `runGeneration` logs run/model/tool lifecycle events to the default logger during generation and accepts injected custom or no-op logging.
  - Only registered generation tool names reach logs; log records contain no sensitive payload fields, and logger errors do not interrupt generation.
  - Every original trace event still reaches report aggregation unchanged; event counts and existing JSON report statistics remain unchanged.
  - Focused offline tests cover lifecycle output and injection, sensitive-field exclusion, unknown tool filtering, and unchanged report aggregation.
- Validation: `npm run typecheck`, `npm test -- src/orchestration.test.ts`, and `npm test`.

### T3: Consolidate recommendation logging
- In scope: `src/agents/recommendation/logger.ts`, `src/agents/recommendation/index.ts`, `src/agents/recommendation/internal.ts`, and focused recommendation tests.
- Out of scope: Generation wiring, recommendation behavior, hooks, tool execution, and report contract changes.
- Acceptance criteria:
  - Existing recommendation logger injection and defaults remain compatible while using the shared logger abstraction and safe console projection.
  - Recommendation lifecycle events are printed once, unknown recommendation tool names are excluded from console output, and full events continue to reach `RunTraceSink` unchanged.
  - Focused offline tests cover shared-logger integration, no duplicate logs, and preservation of report tracing.
- Validation: `npm run typecheck` and `npm test -- src/agents/recommendation/recommendation.test.ts`.

## Status
- Current phase: done
- Notes: T1-T3 complete; typecheck and full 60-test suite pass. Feature reviewer confirmed READY.

## Discoveries & follow-ups
- Shared logger is dependency-free and console-backed by default. `runGeneration` logs lifecycle events as they occur while retaining all full events for report aggregation; recommendation uses the same logger without a second logging path.
- T1 validation: five focused tests and typecheck passed. T2 validation: typecheck, 10 focused orchestration tests, and all 60 tests passed. T3 validation: typecheck and 10 focused recommendation tests passed.

## Review findings
- None