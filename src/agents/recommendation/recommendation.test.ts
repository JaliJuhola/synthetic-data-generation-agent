import { describe, expect, it, vi } from 'vitest';
import { Model } from '@strands-agents/sdk';
import type { BaseModelConfig, Message } from '@strands-agents/sdk';
import type { ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import type {
  AudiencePersonaRecord,
  CampaignPerformanceRecord,
  GenerationState,
  ProductRecord,
  RecordId,
  RunId,
  ShortReference,
} from '../../shared/contracts.js';
import { GenerationError } from '../../shared/contracts.js';
import { noopRunTraceLogger } from '../../shared/logger.js';
import { calculateCtr } from '../../shared/schemas.js';
import { emit } from './internal.js';
import {
  createMockMarketContext,
  createRecommendationAgent,
  recommendationOutputSchema,
  runRecommendations,
  noopRecommendationLogger,
} from './index.js';
import { consoleRecommendationLogger } from './logger.js';
import type { RecommendationLogEvent } from './logger.js';

type ScriptStep = { kind: 'tool'; name: string; input: unknown } | { kind: 'text'; text: string };

class ScriptedModel extends Model {
  constructor(private readonly steps: ScriptStep[]) { super(); }
  updateConfig(_config: BaseModelConfig): void {}
  getConfig(): BaseModelConfig { return {} as BaseModelConfig; }
  stream(_messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const step = this.steps.shift();
    if (!step) throw new Error('Script exhausted');
    return this.response(step);
  }
  private async *response(step: ScriptStep): AsyncIterable<ModelStreamEvent> {
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (step.kind === 'tool') {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: step.name, toolUseId: `use-${this.steps.length}` } };
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify(step.input) } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
    } else {
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: step.text } };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    }
    yield { type: 'modelMetadataEvent', usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } };
  }
}

const campaignId = '00000000-0000-4000-8000-000000000010' as RecordId;
const productId = '00000000-0000-4000-8000-000000000011' as RecordId;
const untestedProductId = '00000000-0000-4000-8000-000000000012' as RecordId;
const personaId = '00000000-0000-4000-8000-000000000013' as RecordId;
const secondPersonaId = '00000000-0000-4000-8000-000000000014' as RecordId;
const performanceId = '00000000-0000-4000-8000-000000000015' as RecordId;
const runId = '00000000-0000-4000-8000-000000000001' as RunId;

function fixture() {
  const products = new Map<RecordId, ProductRecord>([
    [productId, { id: productId, name: 'Fictional Trail Pack', description: 'Compact pack for short hikes.', category: 'Outdoor gear', price: 48, attributes: { capacity: '18L' } }],
    [untestedProductId, { id: untestedProductId, name: 'Fictional Trail Bottle', description: 'Reusable bottle for day trips.', category: 'Outdoor gear', price: 16, attributes: { material: 'steel' } }],
  ]);
  const personas = new Map<RecordId, AudiencePersonaRecord>([
    [personaId, { id: personaId, name: 'Synthetic Day Hikers', summary: 'Like compact equipment for local trails.', interests: ['Backpacking', 'Ultralight Hiking'], contextualTargeting: ['Lightweight Hiking Backpack Comparisons'], ageGroup: '25-34', country: 'US', productIds: [productId, untestedProductId] }],
    [secondPersonaId, { id: secondPersonaId, name: 'Synthetic Weekend Walkers', summary: 'Prefer simple gear for casual outdoor breaks.', interests: ['Backpacking', 'Ultralight Hiking'], contextualTargeting: ['Lightweight Hiking Backpack Comparisons'], ageGroup: '35-44', country: 'CA', productIds: [productId, untestedProductId] }],
  ]);
  const dailyMeasurements = [{ date: '2026-05-29', impressions: 1000, clicks: 25 }];
  const record: CampaignPerformanceRecord = {
    id: performanceId,
    campaignId,
    personaId,
    productId,
    startDate: '2026-05-01',
    endDate: '2026-05-29',
    impressions: 1000,
    clicks: 25,
    ctr: calculateCtr(1000, 25),
    dailyMeasurements,
  };
  const state: GenerationState = {
    runId,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    targeting: { interests: ['Backpacking', 'Ultralight Hiking'], contextualTargeting: ['Lightweight Hiking Backpack Comparisons'] },
    references: new Map<ShortReference, RecordId>([
      ['product-1' as ShortReference, productId],
      ['product-2' as ShortReference, untestedProductId],
      ['persona-1' as ShortReference, personaId],
      ['persona-2' as ShortReference, secondPersonaId],
    ]),
    products,
    personas,
    campaignPerformance: new Map([[performanceId, record]]),
  };
  return { state, record };
}

function recommendationDraft() {
  return {
    recommendations: [{
      productId: untestedProductId,
      personaIds: [personaId],
      experiment: {
        title: 'Day-hiker bottle message test',
        hypothesis: 'A capacity-focused message may be more relevant to day hikers; the outcome is unknown.',
        variable: 'Product message emphasis',
        control: 'Reusable bottle message focused on material',
        treatment: 'Reusable bottle message focused on day-trip capacity',
        primaryMetric: 'Click-through rate',
        durationDays: 14,
      },
      evidenceRecordIds: [performanceId],
      relevanceReasoning: 'The audience has a recorded response to outdoor gear, and the bottle is an untested product in the same broad category.',
      uncertainties: ['The observed pack response may not transfer to a bottle.', 'No treatment outcome is available before the test.'],
      validationApproach: {
        successCriteria: 'Compare the pre-registered treatment and control CTR using the same attribution window.',
        guardrails: ['Monitor spend per click and delivery balance.'],
        analysisMethod: 'Use a randomized split and report confidence intervals after the planned sample threshold.',
      },
    }],
  };
}

describe('recommendation market context', () => {
  it('is deterministic, date- and country-scoped, fictional, and not historical measurement', () => {
    const first = createMockMarketContext('2026-05-29', 'US');
    expect(createMockMarketContext('2026-05-29', 'US')).toEqual(first);
    expect(first).toMatchObject({
      kind: 'mock-market-context',
      historicalMeasurement: false,
      date: '2026-05-29',
      country: 'US',
      season: 'spring',
    });
    expect(first.weather).toContain('Fictional');
    expect(first.holidays[0]).toContain('Fictional');
    expect(first.shoppingPeriods[0]).toContain('Fictional');
    expect(first.fictionalTrends.every((trend) => trend.includes('Fictional'))).toBe(true);
    expect(createMockMarketContext('2026-12-29', 'CA').season).toBe('winter');
    expect(() => createMockMarketContext('not-a-date', 'US')).toThrow(RangeError);
  });
});

describe('read-only recommendation tools', () => {
  it('exposes no mutation tool and identifies every untested persona-product pair without changing state', async () => {
    const { state, record } = fixture();
    const before = {
      products: structuredClone([...state.products]),
      personas: structuredClone([...state.personas]),
      performance: structuredClone([...state.campaignPerformance]),
      references: structuredClone([...state.references]),
    };
    const { control, tools } = createRecommendationAgent({ state, model: new ScriptedModel([]) });
    control.campaignId = campaignId;
    control.campaignRecords = [record];

    expect(Object.keys(tools)).toEqual([
      'getCampaignOverview',
      'getPersonaPerformance',
      'searchCatalog',
      'getProductDetails',
      'listUntestedCombinations',
      'comparePerformance',
      'getMockMarketContext',
    ]);
    const missing = await tools.listUntestedCombinations.invoke({ limit: 100 });
    expect(missing).toMatchObject({ status: 'success', count: 3 });
    expect(JSON.stringify(missing)).toContain(untestedProductId);
    expect(await tools.comparePerformance.invoke({ groupBy: 'product' })).toMatchObject({
      status: 'success',
      comparisons: [{ id: productId, records: 1, impressions: 1000, clicks: 25, ctr: 0.025 }],
    });
    expect(await tools.getMockMarketContext.invoke({ country: 'US' })).toMatchObject({
      marketContext: { kind: 'mock-market-context', historicalMeasurement: false, date: '2026-05-29', country: 'US' },
    });

    expect([...state.products]).toEqual(before.products);
    expect([...state.personas]).toEqual(before.personas);
    expect([...state.campaignPerformance]).toEqual(before.performance);
    expect([...state.references]).toEqual(before.references);
  });
});

describe('recommendation agent', () => {
  it('formats allowlisted lifecycle data as one readable line', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleRecommendationLogger.log({
      runId,
      event: 'tool.completed',
      agentName: 'recommendation',
      toolName: 'searchCatalog',
      durationMs: 12,
      outcome: 'success',
      usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
      prompt: 'sensitive prompt',
    } as Parameters<typeof consoleRecommendationLogger.log>[0] & { prompt: string });

    expect(consoleLog).toHaveBeenCalledOnce();
    const [line] = consoleLog.mock.calls[0] as [string];
    expect(line).not.toContain('\n');
    expect(line).toContain('recommendation -> searchCatalog (tool) completed (0.012s) -> Success | tokens 7 in, 4 out, 11 total');
    expect(line).not.toContain('sensitive prompt');
    consoleLog.mockRestore();
  });

  it('uses the shared console and no-op logger implementations', () => {
    expect(consoleRecommendationLogger).toMatchObject({ log: expect.any(Function) });
    expect(noopRecommendationLogger).toBe(noopRunTraceLogger);
  });

  it('omits unknown tool names from console logs while preserving the raw report trace', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const traced: Array<{ toolName?: string }> = [];
    const { state } = fixture();
    const { control } = createRecommendationAgent({
      state,
      model: new ScriptedModel([]),
      logger: consoleRecommendationLogger,
      traceSink: (event) => traced.push(event),
    });
    const maliciousToolName = 'searchCatalog\n{"forged":true}';

    emit(control, { event: 'tool.started', agentName: 'recommendation', toolName: 'searchCatalog' });
    emit(control, { event: 'tool.started', agentName: 'recommendation', toolName: maliciousToolName });

    const loggedLines = consoleLog.mock.calls.map(([line]) => line as string);
    expect(loggedLines[0]).toContain('searchCatalog (tool) started');
    expect(loggedLines[1]).not.toContain(maliciousToolName);
    expect(loggedLines[1]).not.toContain('forged');
    expect(loggedLines.join('\n')).not.toContain(maliciousToolName);
    expect(traced.map((event) => event.toolName)).toEqual(['searchCatalog', maliciousToolName]);
    consoleLog.mockRestore();
  });

  it('emits each event once, filters unknown names for injected loggers, and preserves the full sink event', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logged: RecommendationLogEvent[] = [];
    const traced: unknown[] = [];
    const { state } = fixture();
    const { control } = createRecommendationAgent({
      state,
      model: new ScriptedModel([]),
      logger: { log: (event) => logged.push(event) },
      traceSink: (event) => traced.push(event),
    });
    control.logger = consoleRecommendationLogger;

    emit(control, {
      event: 'model.completed',
      agentName: 'recommendation',
      durationMs: 19,
      outcome: 'success',
      usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
    });
    emit(control, { event: 'tool.started', agentName: 'recommendation', toolName: 'unregisteredTool' });

    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(String(consoleLog.mock.calls[0][0])).toContain('recommendation -> model completed (0.019s) -> Success | tokens 7 in, 4 out, 11 total');
    expect(String(consoleLog.mock.calls[1][0])).not.toContain('unregisteredTool');
    expect(traced).toHaveLength(2);
    expect(traced[0]).toMatchObject({
      runId,
      event: 'model.completed',
      agentName: 'recommendation',
      durationMs: 19,
      outcome: 'success',
      usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
      occurredAt: expect.any(String),
    });
    expect(traced[1]).toMatchObject({ event: 'tool.started', toolName: 'unregisteredTool' });
    expect(logged).toHaveLength(0);
    consoleLog.mockRestore();
  });

  it('returns schema-validated experiments with TypeScript-derived observations and correlated mock trace events', async () => {
    const { state } = fixture();
    const initial = structuredClone({ products: [...state.products], personas: [...state.personas], performance: [...state.campaignPerformance] });
    const trace: Array<{ event: string; runId: string; usage?: unknown }> = [];
    const logged: RecommendationLogEvent[] = [];
    const model = new ScriptedModel([
      { kind: 'tool', name: 'getCampaignOverview', input: {} },
      { kind: 'tool', name: 'listUntestedCombinations', input: { limit: 20 } },
      { kind: 'tool', name: 'getPersonaPerformance', input: { personaId } },
      { kind: 'tool', name: 'searchCatalog', input: { query: 'bottle', limit: 5 } },
      { kind: 'tool', name: 'getProductDetails', input: { productId: untestedProductId } },
      { kind: 'tool', name: 'comparePerformance', input: { groupBy: 'product' } },
      { kind: 'tool', name: 'getMockMarketContext', input: { country: 'US' } },
      { kind: 'tool', name: 'strands_structured_output', input: recommendationDraft() },
    ]);
    const result = await runRecommendations({
      state,
      model,
      logger: { log: (event) => logged.push(event) },
      traceSink: (event) => trace.push({ event: event.event, runId: event.runId, usage: event.usage }),
    }, { campaignId });
    const output = recommendationOutputSchema.parse({ campaignId: result.campaignId, recommendations: result.recommendations });
    const recommendation = output.recommendations[0];

    expect(result).toMatchObject({ modelCalls: 8, toolCalls: 8, campaignId });
    expect(recommendation).toMatchObject({
      product: { productId: untestedProductId, category: 'Outdoor gear' },
      audience: { personaIds: [personaId] },
      experiment: { outcomeStatus: 'unknown', primaryMetric: 'Click-through rate' },
      observedEvidence: [{
        kind: 'synthetic-performance-observation',
        performanceRecordId: performanceId,
        impressions: 1000,
        clicks: 25,
        ctr: 0.025,
      }],
      marketContext: [{ kind: 'mock-market-context', historicalMeasurement: false, country: 'US', date: '2026-05-29' }],
    });
    expect(recommendation.experiment.hypothesis).toContain('outcome is unknown');
    expect(recommendation.uncertainties.length).toBeGreaterThan(0);
    expect(trace.every((event) => event.runId === runId)).toBe(true);
    expect(trace.some((event) => event.event === 'model.completed' && event.usage !== undefined)).toBe(true);
    expect(trace.some((event) => event.event === 'tool.completed')).toBe(true);
    expect(logged.map((event) => event.event)).toEqual(expect.arrayContaining([
      'run.started', 'run.completed', 'model.started', 'model.completed', 'tool.started', 'tool.completed',
    ]));
    expect(logged.some((event) => event.event === 'tool.started' && event.toolName === 'getCampaignOverview')).toBe(true);
    expect(logged.some((event) => event.event === 'model.completed' && event.usage !== undefined)).toBe(true);
    expect(logged[0].elapsedMs).toEqual(expect.any(Number));
    const serializedLogs = JSON.stringify(logged);
    expect(serializedLogs).not.toContain('Fictional Trail Pack');
    expect(serializedLogs).not.toContain('Synthetic Day Hikers');
    expect(serializedLogs).not.toContain('Day-hiker bottle message test');
    expect(logged.every((event) => Object.keys(event).every((key) => [
      'runId', 'event', 'agentName', 'toolName', 'elapsedMs', 'durationMs', 'outcome', 'usage',
    ].includes(key)))).toBe(true);
    expect([...state.products]).toEqual(initial.products);
    expect([...state.personas]).toEqual(initial.personas);
    expect([...state.campaignPerformance]).toEqual(initial.performance);
  });

  it('rejects campaign evidence IDs outside the selected campaign and invalid output shapes', async () => {
    const { state } = fixture();
    const draft = recommendationDraft();
    draft.recommendations[0].evidenceRecordIds = ['00000000-0000-4000-8000-000000000099' as RecordId];
    await expect(runRecommendations({ state, model: new ScriptedModel([
      { kind: 'tool', name: 'strands_structured_output', input: draft },
    ]), logger: noopRecommendationLogger }, { campaignId })).rejects.toMatchObject<Partial<GenerationError>>({ code: 'VALIDATION_FAILED' });

    expect(recommendationOutputSchema.safeParse({ campaignId, recommendations: [{ outcomeStatus: 'proven' }] }).success).toBe(false);
  });

  it('rejects hypothetical CTR improvement claims presented as certain or quantified outcomes', async () => {
    const { state } = fixture();
    const draft = recommendationDraft();
    draft.recommendations[0].experiment.hypothesis = 'This treatment will improve CTR by 12%.';
    await expect(runRecommendations({ state, model: new ScriptedModel([
      { kind: 'tool', name: 'strands_structured_output', input: draft },
    ]), logger: noopRecommendationLogger }, { campaignId })).rejects.toMatchObject<Partial<GenerationError>>({ code: 'VALIDATION_FAILED' });
  });

  it('rejects missing or invalid campaigns before any model invocation', async () => {
    const { state } = fixture();
    const model = new ScriptedModel([]);
    await expect(runRecommendations({ state, model, logger: noopRecommendationLogger }, { campaignId: '00000000-0000-4000-8000-000000000099' as RecordId }))
      .rejects.toMatchObject<Partial<GenerationError>>({ code: 'VALIDATION_FAILED' });
    expect(() => createRecommendationAgent({ state, model, limits: { maxToolCalls: 0 } }))
      .toThrow(/limits must be positive integers/);
  });
});