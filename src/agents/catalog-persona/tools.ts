import { randomUUID } from 'node:crypto';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type {
  AudiencePersonaRecord,
  GenerationState,
  ProductRecord,
  RecordId,
  RunTraceSink,
  ShortReference,
} from '../../shared/contracts.js';
import { validatePersona, validateProduct, assessPersonaCandidate } from '../../shared/validation.js';
import {
  MAXIMUM_PERSONA_SIMILARITY,
  PRODUCTS_PER_GROUP,
  SUPPORTED_AGE_GROUPS,
  type CatalogPersonaLimits,
  type SupportedCountry,
} from './constants.js';
import { catalogQuerySchema, personaCandidateSchema, productBatchSchema } from './schemas.js';

type Phase = 'catalog' | 'persona' | 'complete';

export const CATALOG_PERSONA_TOOL_NAMES = {
  saveProductBatch: 'saveProductBatch',
  getProductGroups: 'getProductGroups',
  catalogSummary: 'catalogSummary',
  searchCatalog: 'searchCatalog',
  validateCatalog: 'validateCatalog',
  getTargetingOptions: 'getTargetingOptions',
  savePersonaCandidate: 'savePersonaCandidate',
} as const;

export interface RunControl {
  phase: Phase;
  selectedCountry?: SupportedCountry;
  requestedProducts: number;
  requestedProductGroups?: number;
  requestedPersonas: number;
  requestedProductsPerPersona?: number;
  personaAttempts: number;
  modelCalls: number;
  toolCalls: number;
  contextTokensUsed: number;
  toolStartedAt: Map<string, number>;
  modelStartedAt?: number;
  startedAt: number;
  limits: CatalogPersonaLimits;
  state: GenerationState;
  traceSink?: RunTraceSink;
}

const statusResultSchema = z.object({
  status: z.enum(['success', 'error']),
  errorCode: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

const productSummary = (reference: string, product: ProductRecord) => ({
  reference,
  name: product.name,
  category: product.category,
  price: product.price,
});

const personaSummary = (reference: string, persona: AudiencePersonaRecord) => ({
  reference,
  name: persona.name,
  ageGroup: persona.ageGroup,
  country: persona.country,
  productCount: persona.productIds.length,
});

function success<T extends Record<string, unknown>>(data: T) {
  return statusResultSchema.parse({ status: 'success', ...data });
}

function failure(errorCode: string, message: string, progress?: { accepted: number; requested: number; attempts: number; rejected: number }) {
  return statusResultSchema.parse({ status: 'error', errorCode, message, ...(progress ? { progress } : {}) });
}

function referenceFor(state: GenerationState, id: RecordId): string {
  for (const [reference, recordId] of state.references) {
    if (recordId === id) return reference;
  }
  return 'unreferenced';
}

function validationMessage(issues: readonly { path: string; message: string }[]): string {
  return issues.slice(0, 5).map((issue) => `${issue.path || 'record'}: ${issue.message}`).join('; ');
}

function productGroupCounts(state: GenerationState) {
  const groups = new Map<string, { category: string; count: number }>();
  for (const product of state.products.values()) {
    const key = product.category.trim().toLocaleLowerCase('en-US');
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { category: product.category, count: 1 });
  }
  return [...groups.values()];
}

function catalogValidationIssues(state: GenerationState, expectedProductGroups?: number) {
  const issues: Array<{ path: string; message: string }> = [];
  const names = new Set<string>();
  for (const product of state.products.values()) {
    const validation = validateProduct(product);
    issues.push(...validation.issues.map(({ path, message }) => ({ path: `products.${product.id}.${path}`, message })));
    const name = product.name.trim().toLocaleLowerCase('en-US');
    if (names.has(name)) issues.push({ path: `products.${product.id}.name`, message: 'Product name duplicates an existing catalog product' });
    names.add(name);
  }
  if (expectedProductGroups !== undefined) {
    const groups = productGroupCounts(state);
    if (groups.length !== expectedProductGroups) {
      issues.push({ path: 'productGroups', message: `Expected ${expectedProductGroups} distinct product groups, found ${groups.length}` });
    }
    for (const group of groups) {
      if (group.count !== PRODUCTS_PER_GROUP) {
        issues.push({ path: `productGroups.${group.category}`, message: `Expected ${PRODUCTS_PER_GROUP} products, found ${group.count}` });
      }
    }
  }
  return issues;
}

export function createCatalogPersonaTools(control: RunControl) {
  const saveProductBatch = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.saveProductBatch,
    description: 'Validate and store one batch of up to five fictional products, assigning UUIDs and short references in TypeScript. In grouped runs, every batch must use one category and each category group contains exactly ten products across batches. Returns concise saved summaries or actionable validation/limit errors.',
    inputSchema: productBatchSchema,
    callback: ({ products }) => {
      if (control.phase !== 'catalog') return failure('PHASE_CLOSED', 'Products can only be added during the catalog phase.');
      const payloadBytes = Buffer.byteLength(JSON.stringify(products), 'utf8');
      if (payloadBytes > control.limits.maxPayloadBytes) return failure('PAYLOAD_LIMIT', 'Product batch exceeds the permitted payload size; send a smaller batch.');
      if (control.state.products.size + products.length > control.requestedProducts) {
        return failure('COUNT_LIMIT', `Only ${Math.max(0, control.requestedProducts - control.state.products.size)} product(s) remain in the requested count.`);
      }
      if (control.state.products.size + products.length > control.limits.maxRecordsPerType) {
        return failure('RECORD_LIMIT', 'The configured product record limit would be exceeded.');
      }
      if (control.requestedProductGroups !== undefined) {
        const categories = new Set(products.map((product) => product.category.trim().toLocaleLowerCase('en-US')));
        if (categories.size !== 1) return failure('MIXED_PRODUCT_GROUP', 'Each product batch must contain products from exactly one category group.');
        const category = products[0].category.trim();
        const categoryKey = category.toLocaleLowerCase('en-US');
        const groups = productGroupCounts(control.state);
        const existingGroup = groups.find((group) => group.category.trim().toLocaleLowerCase('en-US') === categoryKey);
        if ((existingGroup?.count ?? 0) + products.length > PRODUCTS_PER_GROUP) {
          return failure('GROUP_SIZE_LIMIT', `Product group "${category}" may contain at most ${PRODUCTS_PER_GROUP} products.`);
        }
        if (!existingGroup && groups.length >= control.requestedProductGroups) {
          return failure('GROUP_COUNT_LIMIT', `The requested ${control.requestedProductGroups} product group(s) have already been started.`);
        }
      }
      const knownNames = new Set([...control.state.products.values()].map((product) => product.name.toLocaleLowerCase('en-US')));
      const candidateNames = new Set<string>();
      for (const product of products) {
        const name = product.name.toLocaleLowerCase('en-US');
        if (knownNames.has(name) || candidateNames.has(name)) return failure('DUPLICATE_PRODUCT', `Product name "${product.name}" already exists; submit a distinct product.`);
        candidateNames.add(name);
        const validation = validateProduct({ id: randomUUID(), ...product });
        if (!validation.valid) return failure('VALIDATION_FAILED', validationMessage(validation.issues));
      }

      const saved = products.map((candidate) => {
        const product: ProductRecord = { id: randomUUID() as RecordId, ...candidate };
        const reference = `product-${control.state.products.size + 1}` as ShortReference;
        control.state.products.set(product.id, product);
        control.state.references.set(reference, product.id);
        return productSummary(reference, product);
      });
      return success({ saved, progress: { accepted: control.state.products.size, requested: control.requestedProducts } });
    },
  });

  const getProductGroups = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.getProductGroups,
    description: 'List product categories already used as groups in this generation and their product counts, so the model can choose a new group without repeating one.',
    inputSchema: z.object({}),
    callback: () => control.phase !== 'catalog'
      ? failure('PHASE_CLOSED', 'Product groups are available during the catalog phase.')
      : success({
        groups: productGroupCounts(control.state),
        productsPerGroup: PRODUCTS_PER_GROUP,
        ...(control.requestedProductGroups === undefined ? {} : {
          requestedGroups: control.requestedProductGroups,
          remainingGroups: Math.max(0, control.requestedProductGroups - productGroupCounts(control.state).length),
        }),
      }),
  });

  const catalogSummary = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.catalogSummary,
    description: 'Return product count and concise product names, categories, prices, and short references without returning full product records.',
    inputSchema: z.object({}),
    callback: () => success({
      count: control.state.products.size,
      products: [...control.state.products.values()].map((product) => productSummary(referenceFor(control.state, product.id), product)),
    }),
  });

  const searchCatalog = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.searchCatalog,
    description: 'Search the accepted catalog by text and return at most ten concise product summaries; an empty result is a successful search.',
    inputSchema: catalogQuerySchema,
    callback: ({ query, limit }) => {
      const needle = query.toLocaleLowerCase('en-US');
      const matches = [...control.state.products.values()].filter((product) => [
        product.name, product.description, product.category, ...Object.values(product.attributes),
      ].some((value) => value.toLocaleLowerCase('en-US').includes(needle))).slice(0, limit);
      return success({ matches: matches.map((product) => productSummary(referenceFor(control.state, product.id), product)), count: matches.length });
    },
  });

  const validateCatalog = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.validateCatalog,
    description: 'Validate accepted product schemas and unique product names; returns an issue count and concise actionable issues.',
    inputSchema: z.object({}),
    callback: () => {
      const issues = catalogValidationIssues(control.state, control.requestedProductGroups);
      return issues.length === 0
        ? success({ valid: true, count: control.state.products.size, groups: productGroupCounts(control.state).length, issues: [] })
        : {
          ...failure('VALIDATION_FAILED', `Catalog validation found ${issues.length} issue(s).`),
          issues: issues.slice(0, 10),
        };
    },
  });

  const getTargetingOptions = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.getTargetingOptions,
    description: 'Return authoritative targeting values, supported age groups, and the caller-selected country to assign to every persona. Values must be used exactly as returned.',
    inputSchema: z.object({}),
    callback: () => control.phase === 'persona'
      ? success({
        interests: control.state.targeting.interests,
        contextualTargeting: control.state.targeting.contextualTargeting,
        supportedAgeGroups: SUPPORTED_AGE_GROUPS,
        selectedCountry: control.selectedCountry,
      })
      : failure('PHASE_CLOSED', 'Targeting options are available during the persona phase.'),
  });

  const savePersonaCandidate = tool({
    name: CATALOG_PERSONA_TOOL_NAMES.savePersonaCandidate,
    description: 'Validate and assess one persona candidate against authoritative targeting, supported age groups, the caller-selected country, accepted product references, and existing personas. TypeScript assigns the selected country; candidate country fields are ignored. Persists only accepted candidates and returns concise progress/overlap feedback.',
    inputSchema: personaCandidateSchema,
    callback: (candidate) => {
      if (control.phase !== 'persona') return failure('PHASE_CLOSED', 'Personas can only be added during the persona phase.');
      control.personaAttempts += 1;
      const rejected = control.personaAttempts - control.state.personas.size;
      const progress = {
        accepted: control.state.personas.size,
        requested: control.requestedPersonas,
        attempts: control.personaAttempts,
        rejected,
      };
      if (!control.selectedCountry) return failure('COUNTRY_REQUIRED', 'A supported country must be selected before saving personas.', progress);
      const payloadBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      if (payloadBytes > control.limits.maxPayloadBytes) return failure('PAYLOAD_LIMIT', 'Persona candidate exceeds the permitted payload size; shorten the summary or targeting lists.', progress);
      if (control.state.personas.size >= control.requestedPersonas) return failure('COUNT_LIMIT', 'The requested persona count has already been reached.', progress);
      if (control.requestedProductsPerPersona !== undefined && candidate.productReferences.length !== control.requestedProductsPerPersona) {
        return failure('PRODUCT_REFERENCE_COUNT', `Each persona must reference exactly ${control.requestedProductsPerPersona} product(s).`, progress);
      }

      const productIds: RecordId[] = [];
      for (const reference of candidate.productReferences) {
        const id = control.state.references.get(reference as ShortReference);
        if (!id || !control.state.products.has(id)) return failure('UNRESOLVED_PRODUCT_REFERENCE', `Product reference "${reference}" is not an accepted catalog reference.`, progress);
        productIds.push(id);
      }
      const persona: AudiencePersonaRecord = {
        id: randomUUID() as RecordId,
        name: candidate.name,
        summary: candidate.summary,
        interests: candidate.interests,
        contextualTargeting: candidate.contextualTargeting,
        ageGroup: candidate.ageGroup,
        country: control.selectedCountry,
        productIds,
      };
      const validation = validatePersona(persona, {
        targeting: control.state.targeting,
        supportedAgeGroups: SUPPORTED_AGE_GROUPS,
        supportedCountries: [control.selectedCountry],
      }, new Set(control.state.products.keys()));
      if (!validation.valid) return failure('VALIDATION_FAILED', validationMessage(validation.issues), progress);

      const assessment = assessPersonaCandidate(persona, [...control.state.personas.values()], MAXIMUM_PERSONA_SIMILARITY);
      if (!assessment.accepted) {
        const similar = assessment.mostSimilarPersonaId
          ? control.state.personas.get(assessment.mostSimilarPersonaId)
          : undefined;
        return {
          ...failure('SIMILARITY_REJECTED', `Candidate is too similar to an accepted persona (${assessment.maximumSimilarity.toFixed(2)} overlap; cutoff ${MAXIMUM_PERSONA_SIMILARITY.toFixed(2)}). Revise the audience meaningfully.`, progress),
          overlap: { similarity: assessment.maximumSimilarity, cutoff: MAXIMUM_PERSONA_SIMILARITY, similarName: similar?.name },
        };
      }

      control.state.personas.set(persona.id, persona);
      const reference = `persona-${control.state.personas.size}` as ShortReference;
      control.state.references.set(reference, persona.id);
      return success({ accepted: true, persona: personaSummary(reference, persona), progress: { ...progress, accepted: control.state.personas.size } });
    },
  });

  return { saveProductBatch, getProductGroups, catalogSummary, searchCatalog, validateCatalog, getTargetingOptions, savePersonaCandidate };
}

export function getCatalogValidationIssues(state: GenerationState, expectedProductGroups?: number) {
  return catalogValidationIssues(state, expectedProductGroups);
}

export function getCatalogValidationMessage(issues: readonly { path: string; message: string }[]): string {
  return validationMessage(issues);
}
