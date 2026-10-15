export const CLI_CONFIGURATION = {
  queryParameters: {
    generate: ['groups-of-10', 'personas', 'products-per-persona', 'start-date', 'end-date', 'seed', 'scenario', 'data-dir', 'output'],
    recommend: ['output'],
    evaluation: ['data-dir', 'output'],
  },
  generation: {
    groupsOf10: 3,
    personas: 3,
    productsPerPersona: 5,
    seed: 41,
    scenario: 'Fictional outdoor camera launch; create one synthetic audience and a group of ten related products across the assigned performance tiers.',
  },
  paths: {
    dataDirectory: 'data',
    outputDirectory: 'output',
  },
} as const;

export type CliConfiguration = typeof CLI_CONFIGURATION;