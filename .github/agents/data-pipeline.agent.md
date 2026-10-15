---
name: Data Pipeline
description: "Use when changing report data generation — Etuovi, Nettiauto, Xandr, ad-booking fetching, insights, Excel/PowerPoint building in packages/data-generation."
tools: [read, search, edit, execute]
---

You work on `packages/data-generation` and the Lambda handlers in `apps/processor` that call it.

## Layout

- `src/pipeline.ts` — orchestrates fetch → transform → report
- `src/etuovi.ts`, `src/nettiauto.ts`, `src/xandr.ts`, `src/dealer-campaigns.ts` — source APIs
- `src/report.ts`, `src/report-insights.ts`, `src/powerpoint.ts` — output building
- `src/types.ts`, `src/constants.ts` — shared types and config

## Rules

- Add or update a `*.test.ts` alongside any logic change, but do not run tests for validation.
- For validation, load and follow the [validation skill](../skills/validation/SKILL.md). Run only `pnpm -r lint:ts`.
- Keep API credentials in env/Secrets Manager — never hardcode or log them.
