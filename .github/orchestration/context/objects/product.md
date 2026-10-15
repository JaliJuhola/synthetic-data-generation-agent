# Product

- Represents a fictional item in the generated e-commerce catalog.
- Catalog generation belongs to `src/agents/catalog-persona.ts`; deterministic schemas and validation are in `src/shared/`.
- Product records need a TypeScript-generated UUID; short references may be used within agent prompts and resolved internally.
- Product data includes at least a name, description, category, price, and relevant attributes.
- Persona and campaign-performance records may refer to products; references must resolve to accepted catalog records.
- Product counts are controlled by the generation scenario.