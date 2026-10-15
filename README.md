# Synthetic Advertising Generator

A local Node.js CLI for generating fictional product catalogs, audience personas, synthetic campaign measurements, and experiment recommendations. The deterministic validation and offline evaluation paths use mocked models and do not need Azure credentials or network access.

## Requirements and setup

- Node.js 22 or newer
- npm

Install the locked dependencies and run the offline checks:

```sh
npm ci
npm run typecheck
npm test
npm run cli -- smoke
npm run cli -- eval
```

Azure-backed commands read `AZURE_OPENAI_RESOURCE_NAME`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_DEPLOYMENT`. The resource name is the Azure OpenAI resource name, the API key is its secret key, and the deployment value is the name of the model deployment in that resource, not the model-family name. Values can come from the process environment or a root `.env` file. `.env.example` shows the required field names with placeholders; replace each placeholder with a real value before using Azure. `.env` is ignored by git. The CLI loads it without replacing process environment values and never writes to it; preserve any existing populated `.env` rather than copying over it.

## Targeting data

Generation requires both `data/interests.txt` and `data/page_context.txt`. These are the authoritative targeting lists: the generator trims lines, removes empty entries, and deduplicates exact values while preserving first-seen order. It does not invent or augment targeting values. Keep both files in the selected data directory; `--data-dir` changes the directory but does not change the required filenames. Missing, unreadable, empty, or oversized files fail generation clearly.

## Commands

Run commands from the repository root with `npm run cli -- <command>`. Generated personas use `US` as their fixed country for now.

```sh
# Fully offline; uses mock providers, no Azure credentials or network calls
npm run cli -- smoke --data-dir data --output output
npm run cli -- eval --data-dir data --output output

# Azure-backed generation; writes into a unique run directory under output/
npm run cli -- generate --groups-of-10 2 --personas 2 --products-per-persona 10 --start-date 2026-05-01 --end-date 2026-05-14 --seed 41 --scenario "Fictional outdoor camera launch; compare wildlife image quality and compact trail use across the assigned synthetic performance tiers." --data-dir data --output output

# Azure-backed recommendations from a previously generated dataset
npm run cli -- recommend output/<generation-run-id>/dataset.json --output output/<generation-run-id>
```

`generate` accepts `--groups-of-10`, `--personas`, `--products-per-persona`, `--start-date`, `--end-date`, `--seed`, `--scenario`, `--data-dir`, and `--output`. Each group contains exactly ten products that share a category; the model checks categories already created in the current run before choosing another. Each persona is associated with the configured number of products (1 to 10). Product batches are saved in chunks of at most five. Group history is not retained between runs. The campaign window is the inclusive range between the start and end dates, and is limited to 366 days. Group and persona counts are limited so their product does not exceed 100 performance records. Dataset and JSON artifact sizes are limited to 5 MB; each targeting file is limited to 256,000 bytes. `--help` prints the command forms. The JSON files under `examples/scenarios/` are fixed, fictional scenario recipes, not input files accepted directly by the CLI: use their fields to supply the corresponding CLI flags, with `campaignInstructions` as the `--scenario` text.

`smoke` checks local generation and recommendation wiring; `eval` runs the same kind of mocked path and writes an evaluation summary. Both run without Azure configuration. `recommend` reads and validates a local dataset, then produces hypotheses without modifying that dataset.

## Outputs and interpretation

Each run creates a unique directory under the chosen output root. `generate` writes `dataset.json` and `generation-report.json`. `recommend` writes `recommendations.json` and `recommendation-report.json`. `smoke` and `eval` also write `evaluation-report.json`, alongside the generated dataset and recommendation artifacts. Reports include run IDs, requested and actual record counts, validation results, completed phases, model/tool call counts, repair attempts, duration, and token usage when the provider exposes it. Secrets, full prompts, and full tool payloads are not report fields.

All campaign performance is synthetic historic measurement data, not observed advertising performance. Mock market context is fictional and is not a historical measurement. Recommendations separate available evidence from unknowns and are hypotheses to test, not proven results or guaranteed CTR improvements. Model-backed generation is not byte-for-byte deterministic; use the offline mocked tests for reproducible behavior. A seed makes the TypeScript performance distribution repeatable for the same inputs, but generated record IDs and model responses can differ.
