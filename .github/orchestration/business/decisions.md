# Business decisions

Durable product and contract rulings, appended by the orchestrator.

## Synthetic advertising generator

- Targeting values are authoritative from `data/interests.txt` and `data/page_context.txt`; load, trim, drop empty lines, and exact-deduplicate while preserving first-seen order. Do not create replacement or additional values.
- For now, each generation uses `US` as its fixed persona country. The CLI does not expose a country selector; revisit this decision if multi-country generation becomes a requirement.
- CLI generation uses `groupsOf10` to request category groups of exactly ten products. A product's `category` is its group label; group uniqueness is checked within the current run only. Each group can be saved in batches of at most five, and performance tiers continue rotating per persona-product pair.
- Each accepted persona has exactly two interests and exactly one contextual targeting value, selected from the authoritative targeting files. Persisted datasets must satisfy the same cardinality; regenerate older datasets that do not.
