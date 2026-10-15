import { describe, expect, it } from 'vitest';
import { Model } from '@strands-agents/sdk';
import type { BaseModelConfig, Message } from '@strands-agents/sdk';
import type { ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import type { GenerationState, RunId, RunTraceEvent, ShortReference } from '../../shared/contracts.js';
import { GenerationError } from '../../shared/contracts.js';
import {
  DEFAULT_CATALOG_PERSONA_LIMITS,
  MAXIMUM_PERSONA_SIMILARITY,
  SUPPORTED_AGE_GROUPS,
  SUPPORTED_COUNTRIES,
} from './constants.js';
import { personaCandidateSchema, productCandidateSchema } from './schemas.js';
import {
  createCatalogPersonaAgent,
  runCatalogPersonaGeneration,
} from './index.js';
import type { CatalogPersonaRequest } from './actions/types.js';

type ScriptStep = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: unknown };

class ScriptedModel extends Model {
  constructor(private readonly steps: ScriptStep[]) {
    super();
  }

  updateConfig(_config: BaseModelConfig): void {}

  getConfig(): BaseModelConfig {
    return {} as BaseModelConfig;
  }

  stream(_messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const step = this.steps.shift();
    if (!step) throw new Error('Script exhausted');
    return this.response(step);
  }

  private async *response(step: ScriptStep): AsyncIterable<ModelStreamEvent> {
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (step.kind === 'tool') {
      yield {
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: step.name, toolUseId: `use-${this.steps.length}` },
      };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: JSON.stringify(step.input) },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
    } else {
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: step.text } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    }
    yield { type: 'modelMetadataEvent', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
  }
}

const productInput = {
  products: [{
    name: 'Cloudberry Trail Lantern',
    description: 'A fictional rechargeable lantern for compact campsites.',
    category: 'Camping',
    price: 42.5,
    attributes: { lightModes: 'three' },
  }],
};

function makeState(): GenerationState {
  return {
    runId: '00000000-0000-4000-8000-000000000001' as RunId,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    targeting: {
      interests: ['Backpacking', 'Camping'],
      contextualTargeting: ['Four-Season Tent Reviews'],
    },
    references: new Map(),
    products: new Map(),
    personas: new Map(),
    campaignPerformance: new Map(),
  };
}

const candidate = {
  name: 'Synthetic Weekend Camp Planners',
  summary: 'A fictional audience interested in compact overnight camping plans.',
  interests: ['Backpacking', 'Camping'],
  contextualTargeting: ['Four-Season Tent Reviews'],
  ageGroup: '25-34',
  productReferences: ['product-1'],
};

describe('catalog and persona agent', () => {
  it('requires exactly two interests and one contextual value, without a candidate price ceiling', () => {
    expect(personaCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(personaCandidateSchema.safeParse({ ...candidate, interests: ['Backpacking'] }).success).toBe(false);
    expect(personaCandidateSchema.safeParse({ ...candidate, interests: ['Backpacking', 'Camping', 'Hiking'] }).success).toBe(false);
    expect(personaCandidateSchema.safeParse({ ...candidate, contextualTargeting: [] }).success).toBe(false);
    expect(personaCandidateSchema.safeParse({ ...candidate, contextualTargeting: ['Four-Season Tent Reviews', 'Trail Guides'] }).success).toBe(false);

    const highPriceProduct = { ...productInput.products[0], price: 1_000_001 };
    expect(productCandidateSchema.safeParse(highPriceProduct).success).toBe(true);
    expect(productCandidateSchema.safeParse({ ...highPriceProduct, price: -1 }).success).toBe(false);
    expect(productCandidateSchema.safeParse({ ...highPriceProduct, price: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('keeps age, country, similarity, and batch bounds explicit', () => {
    expect(SUPPORTED_AGE_GROUPS).toEqual(['18-24', '25-34', '35-44', '45-54', '55-64', '65+']);
    expect(SUPPORTED_COUNTRIES).toEqual(['US', 'CA', 'GB', 'AU']);
    expect(MAXIMUM_PERSONA_SIMILARITY).toBe(0.8);
    expect(DEFAULT_CATALOG_PERSONA_LIMITS.maxRuntimeMs).toBeGreaterThan(0);
  });

  it('stores validated product batches with UUIDs and returns concise summaries/search results', async () => {
    const state = makeState();
    const { control, tools } = createCatalogPersonaAgent({ state, model: new ScriptedModel([]) });
    control.requestedProducts = 1;

    const saved = await tools.saveProductBatch.invoke(productInput);
    expect(saved).toMatchObject({ status: 'success', progress: { accepted: 1, requested: 1 } });
    expect(state.products.size).toBe(1);
    const product = [...state.products.values()][0];
    expect(product.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.references.get('product-1' as ShortReference)).toBe(product.id);
    expect(JSON.stringify(saved)).not.toContain(product.description);
    expect(await tools.searchCatalog.invoke({ query: 'cloudberry', limit: 5 })).toMatchObject({
      status: 'success',
      matches: [{ reference: 'product-1', name: product.name }],
    });
    expect(await tools.validateCatalog.invoke({})).toMatchObject({ status: 'success', valid: true });
  });

  it('tracks category groups and requires ten products per group across batches', async () => {
    const state = makeState();
    const { control, tools } = createCatalogPersonaAgent({ state, model: new ScriptedModel([]) });
    control.requestedProducts = 20;
    control.requestedProductGroups = 2;
    const batch = (category: string, firstNumber: number, count = 5) => ({
      products: Array.from({ length: count }, (_, index) => ({
        ...productInput.products[0],
        name: `${category} Synthetic Model ${firstNumber + index}`,
        category,
      })),
    });

    expect(await tools.getProductGroups.invoke({})).toMatchObject({
      status: 'success',
      groups: [],
      productsPerGroup: 10,
      requestedGroups: 2,
      remainingGroups: 2,
    });
    expect(await tools.saveProductBatch.invoke({ products: [
      batch('Bikes', 1).products[0],
      batch('ATVs', 1).products[0],
    ] })).toMatchObject({ status: 'error', errorCode: 'MIXED_PRODUCT_GROUP' });

    await tools.saveProductBatch.invoke(batch('Bikes', 1));
    expect(await tools.getProductGroups.invoke({})).toMatchObject({
      groups: [{ category: 'Bikes', count: 5 }],
      remainingGroups: 1,
    });
    await tools.saveProductBatch.invoke(batch('Bikes', 6));
    expect(await tools.saveProductBatch.invoke(batch('Bikes', 11, 1)))
      .toMatchObject({ status: 'error', errorCode: 'GROUP_SIZE_LIMIT' });

    await tools.saveProductBatch.invoke(batch('ATVs', 1));
    await tools.saveProductBatch.invoke(batch('ATVs', 6));
    expect(await tools.validateCatalog.invoke({})).toMatchObject({
      status: 'success',
      valid: true,
      count: 20,
      groups: 2,
    });
    expect(await tools.getProductGroups.invoke({})).toMatchObject({
      groups: [{ category: 'Bikes', count: 10 }, { category: 'ATVs', count: 10 }],
      remainingGroups: 0,
    });
  });

  it('uses the group inventory tool and completes a requested ten-product group', async () => {
    const state = makeState();
    const batch = (firstNumber: number) => ({
      products: Array.from({ length: 5 }, (_, index) => ({
        ...productInput.products[0],
        name: `Synthetic Trail Bike ${firstNumber + index}`,
        category: 'Trail Bikes',
      })),
    });
    const model = new ScriptedModel([
      { kind: 'tool', name: 'getProductGroups', input: {} },
      { kind: 'tool', name: 'saveProductBatch', input: batch(1) },
      { kind: 'tool', name: 'saveProductBatch', input: batch(6) },
      { kind: 'text', text: 'Product group complete.' },
    ]);

    const result = await runCatalogPersonaGeneration({ state, model }, {
      products: 10,
      groupsOf10: 1,
      personas: 0,
      country: 'US',
      scenario: 'Fictional trail bike collection.',
    });

    expect(result).toMatchObject({ products: 10, personas: 0, modelCalls: 4, toolCalls: 3 });
    expect(new Set([...state.products.values()].map((product) => product.category))).toEqual(new Set(['Trail Bikes']));
    expect([...state.products.values()]).toHaveLength(10);
  });

  it('repairs a partially saved product group without replacing accepted products', async () => {
    const state = makeState();
    const batch = (firstNumber: number) => ({
      products: Array.from({ length: 5 }, (_, index) => ({
        ...productInput.products[0],
        name: `Synthetic Camera Accessory ${firstNumber + index}`,
        category: 'Camera Accessories',
      })),
    });
    const model = new ScriptedModel([
      { kind: 'tool', name: 'getProductGroups', input: {} },
      { kind: 'tool', name: 'saveProductBatch', input: batch(1) },
      { kind: 'text', text: 'First batch saved.' },
      { kind: 'tool', name: 'getProductGroups', input: {} },
      { kind: 'tool', name: 'saveProductBatch', input: batch(6) },
      { kind: 'tool', name: 'validateCatalog', input: {} },
      { kind: 'text', text: 'The incomplete group is now complete.' },
    ]);

    const result = await runCatalogPersonaGeneration({ state, model }, {
      products: 10,
      groupsOf10: 1,
      personas: 0,
      country: 'US',
      scenario: 'Fictional camera accessories.',
    });

    expect(result).toMatchObject({ products: 10, personas: 0, repairAttempts: 1, modelCalls: 7, toolCalls: 5 });
    expect([...state.products.values()].map((product) => product.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Synthetic Camera Accessory ${index + 1}`),
    );
  });

  it('rejects invalid and similar persona candidates without persisting them', async () => {
    const state = makeState();
    const { control, tools } = createCatalogPersonaAgent({ state, model: new ScriptedModel([]) });
    control.requestedProducts = 1;
    control.requestedPersonas = 2;
    control.selectedCountry = 'CA';
    await tools.saveProductBatch.invoke(productInput);
    control.phase = 'persona';
    expect(await tools.getTargetingOptions.invoke({})).toMatchObject({ status: 'success', selectedCountry: 'CA' });

    await expect(tools.savePersonaCandidate.invoke({ ...candidate, interests: ['Backpacking'] }))
      .rejects.toThrow(/exactly 2 items/);
    const invalid = await tools.savePersonaCandidate.invoke({ ...candidate, interests: ['Backpacking', 'not-authoritative'] });
    expect(invalid).toMatchObject({ status: 'error', errorCode: 'VALIDATION_FAILED' });
    const duplicate = await tools.savePersonaCandidate.invoke({ ...candidate, interests: ['Backpacking', 'Backpacking'] });
    expect(duplicate).toMatchObject({ status: 'error', errorCode: 'VALIDATION_FAILED' });
    expect(state.personas.size).toBe(0);

    const accepted = await tools.savePersonaCandidate.invoke(candidate);
    expect(accepted).toMatchObject({ status: 'success', accepted: true, progress: { accepted: 1, requested: 2 } });
    expect([...state.personas.values()][0].country).toBe('CA');
    const similar = await tools.savePersonaCandidate.invoke(candidate);
    expect(similar).toMatchObject({ status: 'error', errorCode: 'SIMILARITY_REJECTED', overlap: { cutoff: 0.8, similarity: 1 } });
    expect(state.personas.size).toBe(1);
  });

  it('enforces the configured product-reference count per persona', async () => {
    const state = makeState();
    const { control, tools } = createCatalogPersonaAgent({ state, model: new ScriptedModel([]) });
    control.requestedProducts = 2;
    await tools.saveProductBatch.invoke({ products: [
      productInput.products[0],
      { ...productInput.products[0], name: 'Fictional Camp Lantern Pro' },
    ] });
    control.phase = 'persona';
    control.selectedCountry = 'US';
    control.requestedPersonas = 1;
    control.requestedProductsPerPersona = 2;

    expect(await tools.savePersonaCandidate.invoke(candidate))
      .toMatchObject({ status: 'error', errorCode: 'PRODUCT_REFERENCE_COUNT' });
    expect(state.personas.size).toBe(0);

    const accepted = await tools.savePersonaCandidate.invoke({
      ...candidate,
      productReferences: ['product-1', 'product-2'],
    });
    expect(accepted).toMatchObject({ status: 'success', accepted: true });
    expect([...state.personas.values()][0].productIds).toHaveLength(2);
  });

  it('traces why a persona candidate was rejected', async () => {
    const state = makeState();
    const twoProducts = {
      products: [
        productInput.products[0],
        { ...productInput.products[0], name: 'Fictional Camp Lantern Pro' },
      ],
    };
    const model = new ScriptedModel([
      { kind: 'tool', name: 'saveProductBatch', input: twoProducts },
      { kind: 'text', text: 'Catalog complete.' },
      { kind: 'tool', name: 'getTargetingOptions', input: {} },
      { kind: 'tool', name: 'catalogSummary', input: {} },
      { kind: 'tool', name: 'savePersonaCandidate', input: candidate },
      { kind: 'text', text: 'Candidate rejected.' },
    ]);
    const trace: RunTraceEvent[] = [];

    await expect(runCatalogPersonaGeneration({
      state,
      model,
      traceSink: (event) => trace.push(event),
    }, {
      products: 2,
      personas: 1,
      productsPerPersona: 2,
      country: 'US',
    })).rejects.toThrow('Persona phase incomplete');

    expect(trace).toContainEqual(expect.objectContaining({
      event: 'tool.completed',
      toolName: 'savePersonaCandidate',
      outcome: 'error',
      errorCode: 'PRODUCT_REFERENCE_COUNT',
    }));
  });

  it('runs catalog then persona tools with a mocked model and traces only correlated summaries', async () => {
    const state = makeState();
    const trace: Array<{ event: string; runId: string; usage?: unknown; durationMs?: number }> = [];
    const model = new ScriptedModel([
      { kind: 'tool', name: 'saveProductBatch', input: productInput },
      { kind: 'text', text: 'Catalog complete.' },
      { kind: 'tool', name: 'getTargetingOptions', input: {} },
      { kind: 'tool', name: 'catalogSummary', input: {} },
      { kind: 'tool', name: 'savePersonaCandidate', input: { ...candidate, country: 'CA' } },
      { kind: 'text', text: 'Persona complete.' },
    ]);

    const result = await runCatalogPersonaGeneration({
      state,
      model,
      limits: { maxContextTokens: 48 },
      traceSink: (event) => trace.push({ event: event.event, runId: event.runId, usage: event.usage, durationMs: event.durationMs }),
    }, { products: 1, personas: 1, country: 'US' });

    expect(result).toMatchObject({ products: 1, personas: 1, modelCalls: 6, toolCalls: 4 });
    expect(trace[0]).toMatchObject({ event: 'run.started', runId: state.runId });
    expect(trace.filter((event) => event.event === 'model.completed').every((event) => event.runId === state.runId)).toBe(true);
    expect(trace.some((event) => event.event === 'model.completed' && event.usage !== undefined)).toBe(true);
    expect(trace.filter((event) => event.event === 'tool.completed').every((event) => event.durationMs !== undefined)).toBe(true);
    expect(state.personas.size).toBe(1);
    expect([...state.personas.values()][0].country).toBe('US');
  });

  it('rejects missing and unsupported request countries before invoking the model', async () => {
    for (const request of [
      { products: 1, personas: 1 },
      { products: 1, personas: 1, country: 'NZ' },
    ]) {
      const state = makeState();
      await expect(runCatalogPersonaGeneration({ state, model: new ScriptedModel([]) }, request as CatalogPersonaRequest))
        .rejects.toMatchObject<Partial<GenerationError>>({
          code: 'VALIDATION_FAILED',
          message: expect.stringContaining('Country must be one of: US, CA, GB, AU'),
        });
      expect(state.products.size).toBe(0);
      expect(state.personas.size).toBe(0);
    }
  });

  it('does not trust a model completion message when requested counts are missing', async () => {
    const state = makeState();
    const model = new ScriptedModel([{ kind: 'text', text: 'All requested products and personas are complete.' }]);
    await expect(runCatalogPersonaGeneration({ state, model }, { products: 1, personas: 1, country: 'US' }))
      .rejects.toMatchObject<Partial<GenerationError>>({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('Catalog phase incomplete') });
    expect(state.products.size).toBe(0);
    expect(state.personas.size).toBe(0);
  });

  it('rejects requests beyond configured record limits before invoking the model', async () => {
    const state = makeState();
    const model = new ScriptedModel([]);
    await expect(runCatalogPersonaGeneration({
      state,
      model,
      limits: { maxRecordsPerType: 1 },
    }, { products: 2, personas: 0, country: 'US' })).rejects.toThrow(/exceeds the configured maximum/);
    expect(() => createCatalogPersonaAgent({ state, model, limits: { maxRuntimeMs: 0 } }))
      .toThrow(/limits must be positive integers/);
  });
});