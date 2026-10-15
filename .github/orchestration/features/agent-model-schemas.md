# Agent Model-Facing Schemas

## Summary
Make agent contracts easier to locate by moving meaningful model-facing Zod schemas into a local `schemas.ts` module in each agent directory. Keep model-generated tool arguments and structured final output schemas together per agent while leaving grouped tool implementations, orchestration request/limits schemas, and domain-owned schemas in place. Enforce exactly two authoritative persona interests and exactly one authoritative contextual targeting value throughout generation and persisted-data validation. Remove the catalog candidate-only price ceiling without changing the shared product price contract.

## Assumptions
- Preserve existing schema descriptions, constraints, exported agent APIs, and behavior except for the specified persona cardinality and catalog candidate price changes.
- Authoritative interest and contextual values continue to come only from their respective data files; no values may be invented.
- Exact 2-interest/1-context validation applies to old persisted datasets too. Existing datasets that violate it, including the current example with 6 interests and 8 context values, must be regenerated before recommendation import.

## Cross-cutting contracts
- Every accepted persona has exactly 2 interests and exactly 1 contextual value. Both must be authoritative allowlisted values; duplicates and out-of-list values remain invalid in model candidates and persisted records.
- Each agent owns a `schemas.ts` for meaningful model-facing schemas, including both model-generated tool-call arguments and structured final outputs. Keep tools grouped per agent; do not create per-tool files. Tiny empty-object schemas and tool-result status schemas may remain with tool implementations.
- Preserve public agent exports, including `recommendationOutputSchema`. Keep internal orchestration request/limits schemas where they are and keep the TypeScript-generated market-context schema in its domain module.
- Catalog candidate prices remain finite and nonnegative, with a description guiding realistic product pricing; do not add a replacement numeric cap.

## Non-goals
- Broad schema redesign, moving shared persisted contracts into agent directories, moving orchestration request/limits or market-context schemas, splitting tools into per-tool files, unrelated fixes, or behavior changes beyond the stated cardinality and price rules.

## Security-sensitive
- None. Targeting values remain restricted to the existing authoritative inputs; this does not change authentication, authorization, IAM, secrets, data-access policy, or public exposure.

## Task DAG
| ID | Owner | Goal | Depends on | Status |
|----|-------|------|------------|--------|
| T1 | synthetic-data-agent | Organize catalog/persona model-facing schemas and enforce candidate cardinality | - | done |
| T2 | synthetic-data-agent | Organize performance model-facing schemas | - | done |
| T3 | synthetic-data-agent | Organize recommendation model-facing schemas | - | done |
| T4 | implementer | Enforce persisted persona cardinality and align documentation | - | done |

### T1: Catalog/persona schemas and candidate rules
- In scope: `src/agents/catalog-persona/tools.ts`, `src/agents/catalog-persona/index.ts`, `src/agents/catalog-persona/prompts/persona-system-prompt.ts`, agent-focused tests, and a new `src/agents/catalog-persona/schemas.ts`.
- Out of scope: shared persisted schemas/validation, unrelated catalog/persona behavior, tool-file decomposition, and moving orchestration request/limits schemas.
- Acceptance criteria:
  - Meaningful catalog product-batch, persona-candidate, and query model-facing schemas are defined in the local `schemas.ts`; grouped tools and agent public exports continue to work without API changes.
  - Persona candidate schema and prompt require exactly 2 authoritative interests and exactly 1 authoritative contextual value. Duplicate or out-of-list values remain rejected.
  - Candidate price has no candidate-only upper bound, retains `.finite().nonnegative()`, and has a realistic-pricing field description; shared `productSchema` remains unchanged.
- Validation: `npm run typecheck`; focused Vitest via `npm test -- src/agents/catalog-persona/catalog-persona.test.ts`.

### T2: Performance schemas
- In scope: `src/agents/performance/tools.ts` and a new `src/agents/performance/schemas.ts`.
- Out of scope: performance workflow/request/limits schemas in `index.ts`, tool-file decomposition, and unrelated performance behavior.
- Acceptance criteria:
  - Meaningful performance metric tool-argument schemas are defined in the local `schemas.ts` and consumed by the grouped tools.
  - Existing descriptions, constraints, tool behavior, and exported agent APIs are preserved.
- Validation: `npm run typecheck`; focused Vitest via `npm test -- src/agents/performance/performance.test.ts`.

### T3: Recommendation schemas
- In scope: `src/agents/recommendation/index.ts`, `src/agents/recommendation/tools.ts`, and a new `src/agents/recommendation/schemas.ts`.
- Out of scope: `src/agents/recommendation/market-context.ts`, orchestration request/limits schemas, tool-file decomposition, and unrelated recommendation behavior.
- Acceptance criteria:
  - Recommendation structured draft/output and meaningful tool-argument schemas are defined in local `schemas.ts`; grouped tools continue to use them.
  - `recommendationOutputSchema` and other existing exported agent APIs remain available, with existing descriptions, constraints, and behavior preserved.
  - The TypeScript-generated market-context schema remains in its domain module.
- Validation: `npm run typecheck`; focused Vitest via `npm test -- src/agents/recommendation/recommendation.test.ts`.

### T4: Persisted persona contract and documentation
- In scope: `src/shared/schemas.ts`, `src/shared/validation.ts`, relevant shared validation tests, orchestration test fixtures in `src/orchestration.test.ts` that construct personas/candidates, and README wording if needed.
- Out of scope: agent-local schema extraction, unrelated shared validation behavior, and changes to authoritative targeting inputs.
- Acceptance criteria:
  - Shared persisted persona schema and validator require exactly 2 interests and exactly 1 contextual value.
  - Tests cover valid cardinality and reject wrong counts, duplicates, and values outside the authoritative lists.
  - All orchestration mocks that construct personas/candidates match the 2-interest/1-context contract.
  - README wording, if it describes persona targeting counts, matches the exact 2/1 contract; otherwise leave it unchanged.
- Validation: `npm run typecheck`; focused Vitest via `npm test -- src/shared/validation.test.ts`; full suite via `npm test` (including orchestration mocks).

## Status
- Current phase: done
- Notes: T1-T4 and review follow-ups R1-R2 complete; typecheck and focused tests pass. Feature reviewer confirmed READY.

## Discoveries & follow-ups
- The model receives these Zod constraints as tool argument schemas or structured-output schemas. `schemas.ts` is used for these agent-specific model-facing contracts; tool-result status schemas and the generated market-context schema remain with their owners.
- Exact 2-interest/1-context cardinality is enforced in candidate generation and persisted validation. Existing datasets with other counts require regeneration before recommendation import.
- Candidate product price now matches the shared contract: finite and nonnegative, without the candidate-only one-million ceiling.

## Review findings
- R1 MINOR (`src/agents/performance/tools.ts`): `getPersonaContext` and `getProductContext` had meaningful model-facing reference schemas inline. Moved both to `src/agents/performance/schemas.ts`; focused performance tests and typecheck passed. Re-review confirmed fixed.
- R2 MINOR (`src/agents/performance/performance.test.ts`, `src/agents/recommendation/recommendation.test.ts`): fixtures used 1 interest and 1 contextual value, bypassing the new persisted 2/1 contract. Updated fixtures/targeting to exactly 2/1; focused tests and typecheck passed. Re-review confirmed fixed.