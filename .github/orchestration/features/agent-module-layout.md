# Agent Module Layout Refactor

## Summary
Refactor the catalog/persona, performance, and recommendation agents into maintainable agent-owned directories without changing runtime behavior. Each agent directory contains a stable `index.ts` entrypoint, one grouped `tools.ts` file, `hooks.ts`, dedicated prompt files under `prompts/`, agent-only schemas/types, and focused tests. Split out deterministic agent-local domain logic only where it is a distinct responsibility. Update CLI and orchestration imports to use the agent entrypoints. This is a structural refactor, not an operational or security/compliance production-readiness effort.

## Assumptions
- Preserve existing model/tool contracts, bounds, trace payload/event semantics, country and targeting rules, recommendation read-only behavior, and exported entrypoint symbols.
- `src/shared/` remains the owner of shared run state, records, schemas, and validation; agent-only schemas/types remain with their agent.
- Similar agent hooks stay agent-local; do not centralize them absent a demonstrated simple helper that reduces meaningful duplication without changing behavior.

## Cross-cutting contracts
- Agent directories are `src/agents/catalog-persona/`, `src/agents/performance/`, and `src/agents/recommendation/`. Each has `index.ts` as its stable public entrypoint, one grouped `tools.ts` (not one file per tool), `hooks.ts`, and its own `prompts/` directory. Keep agent-specific tests alongside that agent. Add schemas/types or deterministic domain modules only when they represent a real agent-local responsibility.
- Keep each agent's `index.ts` focused on agent construction and run entrypoints. Import constants, schemas, tool factories, and module-specific types directly from their defining files instead of forwarding them through the entrypoint.
- During T1-T3, each old flat module path (`src/agents/catalog-persona.ts`, `src/agents/performance.ts`, and `src/agents/recommendation.ts`) remains as a temporary one-line re-export facade to its new `index.ts`. These facades exist only to keep incremental typecheck and existing consumers coherent while implementations move; they are migration-only and not a retained compatibility API. T4 updates internal consumers and removes all three facades.
- Keep shared contracts and behavior in `src/shared/`; do not introduce compatibility shims for old internal paths unless an actual external consumer is identified.

## Non-goals
- Any behavior, prompt, schema contract, model/tool limits, trace semantics, business rule, or output change; unrelated bug fixes; moving shared modules into agent folders.
- One file per tool, a generic hook framework, speculative abstraction layers, retained compatibility shims for old flat module paths (the temporary T1-T3 migration facades are not retained), or a claim of operational/security/compliance production readiness.

## Security-sensitive
- None. This refactor does not change authentication, authorization, IAM, secrets, data-access policy, or public exposure.

## Task DAG
| ID | Owner | Goal | Depends on | Status |
|----|-------|------|------------|--------|
| T1 | synthetic-data-agent | Move catalog/persona internals into its agent-owned module layout | - | done |
| T2 | synthetic-data-agent | Move performance internals into its agent-owned module layout | - | done |
| T3 | synthetic-data-agent | Move recommendation internals into its agent-owned module layout | - | done |
| T4 | implementer | Update external imports to the stable agent entrypoints | T1, T2, T3 | done |

### T1: Catalog/persona module layout
- In scope: `src/agents/catalog-persona.ts` as a temporary one-line re-export facade, its catalog/persona prompt files and tests, and the new `src/agents/catalog-persona/` modules.
- Out of scope: CLI/orchestration import sites, shared contracts/schemas/validation, and catalog/persona behavior changes.
- Acceptance criteria:
  - Catalog/persona construction and phased run orchestration live behind `src/agents/catalog-persona/index.ts`; its grouped tools, hooks, prompts, focused tests, and any genuinely agent-only schema/type or deterministic logic have clear local ownership.
  - `index.ts` exposes the catalog/persona run entrypoint; consumers import constants and types from their defining modules.
  - The old flat module path exports through a one-line re-export facade; implementation code is relocated and the facade remains until T4.
  - Existing behavior and tests preserve tool/model contracts, limits, trace semantics, fixed country selection and targeting rules, and output behavior.
- Validation: `npm run typecheck` and the focused catalog/persona test via `npm test -- src/agents/catalog-persona.test.ts`.

### T2: Performance module layout
- In scope: `src/agents/performance.ts` as a temporary one-line re-export facade, its performance prompt and tests, and the new `src/agents/performance/` modules.
- Out of scope: CLI/orchestration import sites, shared contracts/schemas/validation, and performance behavior changes.
- Acceptance criteria:
  - Performance construction/run orchestration live behind `src/agents/performance/index.ts`; grouped tools, hooks, prompt, focused tests, and distinct deterministic domain logic have clear local ownership.
  - `index.ts` preserves `runPerformanceGeneration`, `PerformanceTier`, `CtrBand`, and `expandDailyMeasurements` for consumers.
  - The old flat module path exports through a one-line re-export facade; implementation code is relocated and the facade remains until T4.
  - Existing behavior and tests preserve request-pair validation, repair bounds, model/tool contracts, trace semantics, and generated measurement behavior.
- Validation: `npm run typecheck` and the focused performance test via `npm test -- src/agents/performance.test.ts`.

### T3: Recommendation module layout
- In scope: `src/agents/recommendation.ts` as a temporary one-line re-export facade, its recommendation prompt and tests, and the new `src/agents/recommendation/` modules.
- Out of scope: CLI/orchestration import sites, shared contracts/schemas/validation, and recommendation behavior changes.
- Acceptance criteria:
  - Recommendation construction/run orchestration live behind `src/agents/recommendation/index.ts`; grouped tools, hooks, prompt, focused tests, and any distinct agent-local schema/domain logic have clear local ownership.
  - `index.ts` preserves `runRecommendations`, `recommendationOutputSchema`, `createMockMarketContext`, and `createRecommendationAgent` for consumers.
  - The old flat module path exports through a one-line re-export facade; implementation code is relocated and the facade remains until T4.
  - Existing behavior and tests preserve output contracts, model/tool bounds, trace semantics, and the read-only boundary.
- Validation: `npm run typecheck` and the focused recommendation test via `npm test -- src/agents/recommendation.test.ts`.

### T4: Consumer import migration
- In scope: agent imports in `src/cli.ts`, `src/orchestration.ts`, and any other existing internal consumers, plus removal of the temporary flat-module facades and minimal associated import-path updates.
- Out of scope: agent internals, retained compatibility wrappers for old paths, and behavior changes.
- Acceptance criteria:
  - All internal consumers import agent symbols through their corresponding stable `index.ts` entrypoints; all three temporary flat-module facades and obsolete prompt paths are removed once no longer used.
  - The repository retains the existing public symbols and behavior, without duplicate compatibility exports or unrelated cleanup.
- Validation: `npm run typecheck` and the focused orchestration test via `npm test -- src/orchestration.test.ts`; run the full `npm test` suite after consumer import integration if practical.

## Status
- Current phase: done
- Notes: T1-T4 complete; typecheck, focused orchestration tests, and full test suite passed. Feature reviewer confirmed READY.

## Discoveries & follow-ups
- T1-T3 each reported focused tests passing. Project typecheck results were inconsistent during concurrent moves; after import migration, T4 reports typecheck, seven orchestration tests, and all 44 tests passing.

## Review findings
- None. Reviewer confirmed the requested per-agent layout, stable exports, consumer imports, and behavior-preserving boundaries.
