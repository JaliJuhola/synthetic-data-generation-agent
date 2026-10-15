# Repository context index

Start here. High-level map only; follow links for detail.

## Purpose

Standalone learning project: LLM-powered agents that generate, validate, and analyze synthetic e-commerce advertising datasets, run locally from a CLI. Source of intent: [README](../../../README.md).

## Areas

- `src/agents/catalog-persona/`, `src/agents/performance/`, and `src/agents/recommendation/` own their respective agent entrypoints, model-facing schemas, grouped tools, hooks, logging, prompts, and focused tests.
- `src/shared/` owns run-state and persisted-record contracts, schemas, deterministic validators, and the safe trace logger.
- `src/shared/config/` owns Azure environment validation and the Strands model adapter.
- `src/orchestration/` owns request contracts, generation/recommendation workflows, trace projection, and persistence helpers; root `configuration.ts` supplies CLI query/default configuration, root `cli.ts` dispatches commands, and `src/cli/` owns argument parsing and command implementations.
- `data/interests.txt` and `data/page_context.txt` are the authoritative targeting inputs for interests and contextual values respectively.

## Entry points

- CLI: root `cli.ts` (`generate`, `recommend`, `eval`, `smoke`), launched by the `npm run cli` script.
- Generation orchestration: `src/orchestration/index.ts`.
- Agent entrypoints: `src/agents/catalog-persona/index.ts`, `src/agents/performance/index.ts`, `src/agents/recommendation/index.ts`.
- Azure model factory/configuration: `src/shared/config/azure-model.ts`, `src/shared/config/azure.ts`.

## Repository rules

- Agent conventions: [architectural-conventions](../../skills/architectural-conventions/SKILL.md).
- Review and validation: [code-review](../../skills/code-review/SKILL.md), [validation](../../skills/validation/SKILL.md).
- Deployment and cloud infrastructure are out of scope.

## Indexes

- [Business decisions](../business/decisions.md)
- [Synthetic advertising generator brief](../features/synthetic-advertising-generator.md)
- [Agent module layout refactor brief](../features/agent-module-layout.md)
- [Business object sheets](objects/README.md)
- [Product](objects/product.md)
- [Audience persona](objects/audience-persona.md)
- [Campaign performance](objects/campaign-performance.md)
