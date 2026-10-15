# Synthetic Advertising Generator

## Summary
Deliver a complete, locally executable Node.js 22+/TypeScript learning CLI using the installed Strands Agents TypeScript SDK and Azure OpenAI through `@ai-sdk/azure` and a supported Strands adapter. Deterministic TypeScript orchestration coordinates three distinct agents: fictional catalog/persona generation, synthetic campaign-performance generation, and read-only experiment recommendations. Include deterministic validation/repair, local JSON artifacts, observability/evaluation, examples, 5-10 representative scenarios, CLI commands, and usable documentation; do not stop at a skeleton.
Generation scenarios select a supported country, which flows through the CLI and orchestration into persona generation; the model cannot select or change it.

## Assumptions
- `recommend` consumes a previously generated local JSON dataset; `generate` creates and saves that dataset.
- Local smoke/evaluation scenarios run with mocked model/provider interactions and do not require Azure credentials. Document the exact first live integration command; no live call is required during implementation.
- Targeting values are deduplicated by exact text after trimming, preserving first-seen order and value casing.

## Cross-cutting contracts
- Each run creates one typed in-memory `GenerationState` and run ID. Deterministic TypeScript owns phase ordering and completion; agents communicate only by calling registered state tools. No process-global run data, database, or checkpoints. TypeScript generates record IDs only with `crypto.randomUUID()`; prompts use short references resolved internally to accepted UUIDs, never repeatedly embedding the full dataset.
- Every generation scenario selects exactly one country from `US`, `CA`, `GB`, or `AU`. The orchestrator passes that selection through the catalog/persona request; accepted personas use exactly the selected country, and the LLM cannot choose another country.
- Interests come from `data/interests.txt`; `data/page_context.txt` is the authoritative contextual targeting list. Load each once per run, trim lines, drop empty lines, deduplicate while preserving first-seen order and exact retained values, never invent or augment values, and fail clearly if either required file is missing.
- Zod schemas govern agent inputs/outputs and deterministic record/cross-record validation. Exports preserve validated IDs and references. Impressions/clicks are nonnegative integers, clicks do not exceed impressions, CTR is a TypeScript-computed fraction (`clicks / impressions`) including defined zero-impression behavior, and daily measurements reconcile with campaign totals.
- Verify installed Strands SDK, Azure provider, and supported adapter APIs before integration; use `@ai-sdk/azure` and a supported adapter where compatible, adding a custom provider only if necessary. Azure config is typed and deployment-compatible; missing/placeholder config fails clearly. Never log credentials or overwrite a populated `.env`.
- Each agent has a separate prompt file. Hooks trace model/tool calls using the run ID and report calls, counts, durations, and token usage when exposed, without logging secrets or full payloads. Explicitly bound calls, turns, retries, repairs, payload/context, and total runtime; use SDK loop/retry/hook APIs where supported and provider retries where available.
- Expected recoverable tool errors are actionable structured results; unrecoverable failures surface clearly at the CLI boundary. Recommendation tools are read-only, distinguish synthetic historical measurements from mocked market context, and produce test hypotheses rather than proven CTR claims.
- Successful generation exports `dataset.json` and `generation-report.json`; recommendations export `recommendations.json` and may include generation IDs. CLI commands are `generate`, `recommend`, `eval`, and `smoke`; local smoke/evaluation paths need no credentials.

## Non-goals
- AWS, AgentCore, cloud infrastructure, deployment, databases, checkpoints, Docker, web UI, server/API, or an unnecessary framework.
- Real advertising data, real people/personas, live market integrations, or claims that hypothetical CTR changes are proven outcomes.
- Live Azure requests as part of routine tests or smoke checks, or broad repository cleanup.

## Security-sensitive
- Azure key/deployment configuration, `.env`, `.env.example`, and `.gitignore`: validate configuration at startup, preserve an existing populated `.env`, ignore `.env`, reject placeholders, and ensure credentials cannot appear in logs, errors, traces, prompts, or output files. Verify deployment-name compatibility and tool-calling support. No authentication or public exposure is introduced.
- Persona realism: generated personas and named details remain fictional and synthetic; do not use real-person identities or present synthetic traits as observations about real people.

## Task DAG
| ID | Owner | Goal | Depends on | Status |
|----|-------|------|------------|--------|
| T1 | implementer | Establish TypeScript foundation, shared state/config contracts, and verify SDK/provider APIs | - | done |
| T2 | implementer | Implement deterministic schemas, data validation, similarity, repair, and evaluation primitives | T1 | done |
| T3 | synthetic-data-agent | Implement the two-phase catalog/persona agent and registered tools | T1, T2 | done |
| T4 | synthetic-data-agent | Implement performance generation and bounded non-destructive repair | T1, T2, T3 | done |
| T5 | synthetic-data-agent | Implement read-only recommendation agent and structured experiments | T1, T2, T4 | done |
| T6 | implementer | Integrate orchestration, CLI, reports, and local JSON exports | T1, T2, T3, T4, T5, T6a, T6b | done |
| T6a | synthetic-data-agent | Add selected country to the catalog/persona request and generation contract | T3 | done |
| T6b | implementer | Pass scenario/CLI country through orchestration into catalog/persona generation | T6a | done |
| T7 | implementer | Add representative scenarios, automated coverage, examples, and documentation for the final CLI contract | T6, T6a, T6b | done |

### T1: Shared foundation and SDK/provider compatibility
- In scope: TypeScript project configuration and minimal package scripts; shared record/type and `GenerationState` contracts; typed Azure environment/config loading; `.env.example` and `.gitignore`; shared limits/errors/tracing interfaces; installed SDK/provider/adapter API verification.
- Out of scope: agent prompts/workflows, deterministic business validation, CLI commands, deployment, and live model calls.
- Acceptance criteria:
  - Shared contracts define run-scoped typed state, run correlation, UUID/reference resolution, targeting values, records, JSON boundaries, and recommendation evidence versus hypotheses; no global mutable run state is introduced.
  - Azure config explicitly handles deployment names and validates required settings at startup. `.env.example` and ignore rules are correct; a populated `.env` is never overwritten and secrets cannot leak to logs/errors.
  - Installed Strands/provider types and supported tool-calling adapter APIs are verified in code/configuration. Use `@ai-sdk/azure`; add a custom provider only if required by incompatibility.
  - SDK hook/model/tool and usage capabilities are represented in shared interfaces without logging full payloads or secrets.
- Validation: No validation command is currently documented/configured; use only repository-documented/configured checks and do not make live Azure calls.

### T2: Deterministic validation and evaluation primitives
- In scope: Pure Zod and TypeScript validation/evaluation for product/persona/performance records, targeting, counts, IDs/references, scenario requirements, duplicates, similarity, CTR/daily consistency, and repair selection.
- Out of scope: Model calls, agent-specific tool wrappers/prompts, local persistence, CLI orchestration, or changing valid originals during repair.
- Acceptance criteria:
  - Validation covers schemas, requested counts, ID uniqueness and references, authoritative targeting membership, supported age/country values, nonnegative integer counts, clicks <= impressions, and deterministic fractional CTR including zero-impression behavior.
  - Campaign/day consistency, scenario requirements, and duplicate detection are deterministic and independently callable without a model.
  - Candidate persona similarity yields deterministic per-candidate accept/reject behavior.
  - Bounded repair targets only invalid/missing data and preserves valid original records, including when repair fails or exhausts its bound.
  - Evaluation results report validation and scenario outcomes without framing synthetic performance as real evidence.
- Validation: No validation command is currently documented/configured; use only repository-documented/configured checks and no live model calls.

### T3: Catalog and persona agent
- In scope: Single Strands agent with dedicated prompt files, product-then-persona phases, focused/batched product model calls, catalog summary/search/validation tools, registered state tools, candidate acceptance, hooks, and agent-specific bounds/errors.
- Out of scope: Performance/recommendation agents, shared provider/config/validator ownership, and CLI integration.
- Acceptance criteria:
  - One agent runs a product phase followed by a persona phase. Product creation uses focused calls and batching; registered tools store records and return concise summaries/search/validation results rather than full repeated catalogs.
  - Candidate inputs/outputs are schema-validated; TypeScript creates IDs and resolves short references to accepted products. Programmatic completion checks ensure requested counts or a clear bounded-incomplete result.
  - Personas are proposed one at a time and accepted/rejected using T2 deterministic similarity; rejected candidates do not count toward completion. Interests/context values come only from loaded files, with valid product references and supported age/country values.
  - Hooks capture correlated tool/model events and available usage; calls, tools, turns, and runtime are bounded. Expected recoverable tool errors are actionable structured results; prompts and dataset context remain separate/concise.
- Validation: No validation command is currently documented/configured; keep model-dependent behavior mockable and do not make live Azure calls.
- Security-sensitive: Azure model/tool traces and fictional persona identity constraints; never log secrets or represent personas as real people.

### T4: Performance generation and repair
- In scope: Separate performance agent and prompt, read-only product/persona context tools, `savePerformance` state tool, workflow hooks, and bounded orchestration of deterministic T2 validation/repair.
- Out of scope: Catalog/persona mutation, recommendations, CLI/output integration, and replacing valid performance data.
- Acceptance criteria:
  - The agent obtains product/persona context through read-only tools and writes only through `savePerformance`; the tool validates references/count constraints and computes fractional CTR deterministically.
  - Performance generation covers required persona/product combinations and campaign daily consistency without repeatedly placing the full dataset in prompts; daily expansion/aggregation is handled programmatically where practical.
  - Validation and repair have explicit bounds; valid originals remain intact if repair fails or exhausts its bound. Tool/model/repair events are correlated and usage reported when exposed.
- Validation: No validation command is currently documented/configured; deterministic logic must remain testable without live Azure calls.

### T5: Read-only recommendation agent
- In scope: Separate recommendation agent and prompt, read-only campaign/product/persona and mocked-market context tools, structured experiment output, hooks, and agent-specific bounds/errors.
- Out of scope: Mutating campaign/catalog/persona data, generating/repairing measurements, external market integrations, and CLI ownership.
- Acceptance criteria:
  - Every recommendation is structured as an experiment with evidence, hypothesis, unknowns, and a validation approach.
  - Historical synthetic observations are explicitly separated from mocked market context and hypothetical outcomes; no recommendation is described as proven CTR improvement.
  - Tools are read-only against completed validated data. Calls/turns/runtime are bounded, errors actionable, and hooks correlated with available tool/model usage.
- Validation: No validation command is currently documented/configured; recommendation paths must be testable with mocked model interactions and no live calls.

### T6: Orchestration, CLI, and local artifacts
- In scope: Deterministic run coordinator; registered state-tool integration; `generate`, `recommend`, `eval`, and `smoke` commands; local JSON loading/writing; run reports and CLI errors.
- Out of scope: Agent internals/prompts, changes to validation rules, databases/services, deployment, and live calls in smoke/evaluation.
- Acceptance criteria:
  - Each run creates one state and UUID run ID; the coordinator enforces required phase order and completion, loads normalized authoritative files once, and fails clearly for missing files.
  - Explicit call/turn/repair/retry/payload/time bounds are enforced at the appropriate orchestration/provider boundary; use supported provider retry behavior where available and surface clear errors otherwise.
  - `generate` writes validated `dataset.json` and `generation-report.json`; `recommend` reads a local dataset and writes `recommendations.json` without mutation; recommendations can reference generation IDs.
  - `eval` reports scenario/validation/repair and call/tool/time statistics plus usage when exposed. `smoke` exercises local wiring and mock paths without credentials or network requests.
  - CLI config/argument/file errors are actionable, and output/logs never expose credentials or full prompts/payloads.
- Validation: No validation command is currently documented/configured; use only documented/configured checks and do not make live model calls.

### T6a: Selected-country catalog/persona request contract
- In scope: `CatalogPersonaRequest` and catalog/persona generation/tool behavior in `src/agents/catalog-persona.ts` and its prompt/schema boundary.
- Out of scope: CLI argument/config parsing, scenario definitions, supported-country expansion, and unrelated persona behavior.
- Acceptance criteria:
  - The catalog/persona request requires a selected country restricted to `US`, `CA`, `GB`, or `AU`.
  - Persona generation uses the request's selected country deterministically; accepted personas all have that exact country, and model output cannot choose or override it.
- Validation: `npm run typecheck` and focused Vitest coverage for the catalog/persona request contract; tests must mock model interactions and make no live model calls.

### T6b: Scenario/CLI country propagation
- In scope: CLI/config and orchestration flow that accepts a generation scenario's selected country and passes it to the catalog/persona request.
- Out of scope: Changing the supported-country set, catalog/persona request/tool implementation, unrelated CLI behavior, or documenting the final interface.
- Acceptance criteria:
  - Generation receives an explicit country from scenario/CLI input, validates it against `US`, `CA`, `GB`, and `AU`, and passes it unchanged through orchestration to the catalog/persona request.
  - Missing or unsupported country input fails clearly rather than defaulting to a model-selected or random country.
- Validation: `npm run typecheck` and focused Vitest coverage for CLI/orchestration country propagation; tests must mock model interactions and make no live model calls.

### T7: Scenarios, tests, examples, and documentation
- In scope: Five to ten representative mock-based scenarios/tests; fictional example inputs/data; README setup, configuration, final CLI country input contract, evaluation, outputs, and live-integration instructions.
- Out of scope: Agent/provider implementation, live credential checks, deployment documentation, and unrelated repository cleanup.
- Acceptance criteria:
  - Five to ten reproducible scenarios cover targeting normalization/missing files, valid/invalid schemas and references, requested-count completion/bounds, duplicates, performance invariants/daily consistency/repair, read-only recommendation evidence, and smoke/evaluation behavior.
  - Scenarios and CLI coverage demonstrate explicit selected-country input and verify generated personas use that selection; documentation names the supported country values and final input form.
  - Tests mock model/provider interactions, need no credentials/network, and cover deterministic core behavior separately from model workflows.
  - Examples and generated records are fictional. README covers Node.js 22+, setup/config, all CLI commands, authoritative targeting files, outputs, bounds, observability/evaluation, and the exact first live Azure integration command.
  - Documentation clearly identifies performance as synthetic and recommendations as hypotheses, not proven results.
- Validation: No validation command is currently documented/configured; do not invent checks or make live model calls.

## Status
- Current phase: done
- Notes: T1-T7 and follow-ups R1-R3 complete; feature reviewer confirmed READY. Earlier worker-run offline checks passed; current editor diagnostics still report the restored recommendation test fixture cast.

## Discoveries & follow-ups
- Installed Strands SDK supports Azure through `VercelModel`; deployment names and the adapter constructor were verified locally without a network request. See `docs/sdk-compatibility.md`.
- Project uses ESM to match the installed Strands package. T1 validation: `npm run typecheck` and four Azure config tests passed.
- T2 validation: 12 focused tests, 16 total tests, and typecheck passed. Validators accept supported age/country sets and persona similarity threshold as inputs; T3 must define the local supported values and cutoff.
- T3 validation: typecheck and all 22 tests passed. The catalog/persona worker disabled provider retries; T6 must verify installed adapter retry support and enable a bounded provider retry path if available.
- T4 validation: typecheck and all 27 tests passed. Performance agent requires campaign dates and non-overlapping CTR bands; CLI/scenarios must supply defaults and validate them.
- T5 validation: typecheck, six focused recommendation tests, and all 33 tests passed. Recommendation workflow is read-only with deterministic market context.
- T6 partial validation: typecheck, all 36 tests, and offline smoke/eval passed. The catalog/persona request lacks a country selector, preventing live generation from applying a scenario's country; planner revision is required before a focused follow-up.
- T6 verified bounded Strands retries: two attempts for throttling errors only; provider retry limitation is documented.
- T6a validation: typecheck, all 37 tests, and offline smoke passed. The agent-side worker also reports changes in the T6b-owned CLI/orchestration paths; T6b must verify those edits and ensure the scenario country reaches persona generation.
- T6b validation: five focused orchestration tests, typecheck, offline smoke, and eval passed; missing/unsupported country inputs are covered.
- T7 validation: typecheck, all 39 tests, offline smoke, and eval passed; no live Azure calls. Two scenario JSON files are CLI input recipes, not files consumed directly by the CLI.
- After review, `get_errors` reports a type diagnostic on the original invalid-evidence test fixture cast in `src/agents/recommendation.test.ts`. User requested restoring that original expression; no terminal runner was available to reconcile this with earlier worker-reported typecheck passes.

## Review findings
- R1 IMPORTANT (`src/agents/performance.ts`, `expandDailyMeasurements`): daily click allocation could exceed daily impressions because zero-impression days received a fallback allocation weight. Fixed with per-day capacity caps and sparse 120-day regression coverage; focused performance tests and typecheck passed. Re-review confirmed fixed.
- R2 IMPORTANT (`src/orchestration.ts`, `runRecommendationFile`): dataset import selected the first performance record's campaign ID while validation permitted multiple campaign IDs, silently omitting other campaigns. Fixed by rejecting mixed-campaign imports before model creation; focused orchestration tests and typecheck passed. Re-review confirmed fixed.
- R3 MINOR (`src/cli.ts`, `generationRequest`): malformed `--start-date` could throw `RangeError` during end-date derivation and produce an opaque local-failure message. Fixed by validating before date arithmetic and adding malformed-input/default-end regression coverage; focused orchestration tests and typecheck passed. Re-review confirmed fixed.