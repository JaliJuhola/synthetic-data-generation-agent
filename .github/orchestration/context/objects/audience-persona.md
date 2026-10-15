# Audience persona

- Represents a fictional advertising audience associated with products or product categories.
- Persona generation belongs to `src/agents/catalog-persona.ts`; deterministic schemas and validation are in `src/shared/`.
- Persona records need a TypeScript-generated UUID and may be addressed by short references inside agent prompts.
- Relevant interests and contextual values must come from the loaded authoritative targeting files; age groups and countries must be supported values.
- Persona product references must resolve to accepted catalog records.
- Candidate personas are checked against existing personas for duplicates or excessive similarity before acceptance.