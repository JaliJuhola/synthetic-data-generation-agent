import { describe, expect, it } from 'vitest';
import { Model } from '@strands-agents/sdk';
import type { BaseModelConfig, Message } from '@strands-agents/sdk';
import type { ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import type { AudiencePersonaRecord, GenerationState, ProductRecord, RecordId, RunId, ShortReference } from '../../shared/contracts.js';
import { GenerationError } from '../../shared/contracts.js';
import { calculateCtr } from '../../shared/schemas.js';
import { validateCampaignPerformance } from '../../shared/validation.js';
import { expandDailyMeasurements, runPerformanceGeneration } from './index.js';
import { metricInputSchema, personaContextInputSchema, productContextInputSchema } from './schemas.js';

type ScriptStep = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: unknown };

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
    yield { type: 'modelMetadataEvent', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
  }
}

const productId = '00000000-0000-4000-8000-000000000011' as RecordId;
const personaId = '00000000-0000-4000-8000-000000000012' as RecordId;

function fixture() {
  const state: GenerationState = {
    runId: '00000000-0000-4000-8000-000000000001' as RunId,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    targeting: { interests: ['Trail Running', 'Backpacking'], contextualTargeting: ['Trail Running Route and Gear Guides'] },
    references: new Map([
      ['persona-1' as ShortReference, personaId],
      ['product-1' as ShortReference, productId],
    ]),
    products: new Map<RecordId, ProductRecord>([[productId, {
      id: productId,
      name: 'Fictional Trail Shoes',
      description: 'Light shoes for rocky day hikes.',
      category: 'Outdoor footwear',
      price: 84,
      attributes: { sole: 'grippy' },
    }]]),
    personas: new Map<RecordId, AudiencePersonaRecord>([[personaId, {
      id: personaId,
      name: 'Synthetic Ridge Runners',
      summary: 'Motivated by lightweight kit for steep, short routes.',
      interests: ['Trail Running', 'Backpacking'],
      contextualTargeting: ['Trail Running Route and Gear Guides'],
      ageGroup: '25-34',
      country: 'US',
      productIds: [productId],
    }]]),
    campaignPerformance: new Map(),
  };
  const request = {
    startDate: '2026-05-01',
    endDate: '2026-05-03',
    seed: 41,
    scenario: 'A fictional launch focused on lightweight trail gear.',
    ctrBands: { low: { min: 0.001, max: 0.01 }, medium: { min: 0.011, max: 0.03 }, high: { min: 0.031, max: 0.1 } },
    pairs: [{ personaReference: 'persona-1', productReference: 'product-1', tier: 'medium' as const }],
  };
  return { state, request };
}

describe('performance metrics', () => {
  it('preserves non-empty short-reference constraints for context tools', () => {
    for (const schema of [personaContextInputSchema, productContextInputSchema]) {
      expect(schema.parse({ reference: ' persona-1 ' })).toEqual({ reference: 'persona-1' });
      expect(schema.safeParse({ reference: ' ' }).success).toBe(false);
      expect(schema.safeParse({ reference: 'x'.repeat(31) }).success).toBe(false);
    }
  });

  it('preserves model-facing metric input constraints', () => {
    expect(metricInputSchema.parse({
      personaReference: ' persona-1 ',
      productReference: ' product-1 ',
      impressions: 100,
      clicks: 10,
    })).toMatchObject({ personaReference: 'persona-1', productReference: 'product-1' });
    expect(metricInputSchema.safeParse({ personaReference: '', productReference: 'product-1', impressions: 100, clicks: 10 }).success).toBe(false);
    expect(metricInputSchema.safeParse({ personaReference: 'persona-1', productReference: 'product-1', impressions: 1.5, clicks: 1 }).success).toBe(false);
    expect(metricInputSchema.safeParse({ personaReference: 'persona-1', productReference: 'product-1', impressions: 10, clicks: 11 }).success).toBe(false);
  });

  it('expands seeded daily counts exactly and computes fractional CTR from integers', () => {
    const first = expandDailyMeasurements('2026-05-01', '2026-05-03', 1001, 21, 41, 'pair');
    const second = expandDailyMeasurements('2026-05-01', '2026-05-03', 1001, 21, 41, 'pair');
    expect(first).toEqual(second);
    expect(first.reduce((sum, day) => sum + day.impressions, 0)).toBe(1001);
    expect(first.reduce((sum, day) => sum + day.clicks, 0)).toBe(21);
    expect(first.every((day) => Number.isInteger(day.impressions) && day.clicks <= day.impressions)).toBe(true);
    expect(calculateCtr(1001, 21)).toBe(21 / 1001);
    expect(validateCampaignPerformance({
      id: '00000000-0000-4000-8000-000000000013',
      campaignId: '00000000-0000-4000-8000-000000000014',
      personaId,
      productId,
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      impressions: 1001,
      clicks: 21,
      ctr: calculateCtr(1001, 21),
      dailyMeasurements: first,
    }).valid).toBe(true);
    expect(() => expandDailyMeasurements('2026-05-01', '2026-05-02', 2, 3, 1, 'pair')).toThrow(RangeError);
  });

  it('keeps sparse daily clicks within impression capacity across a long campaign', () => {
    const daily = expandDailyMeasurements('2026-01-01', '2026-04-30', 3, 3, 41, 'sparse-pair');
    expect(daily).toHaveLength(120);
    expect(daily.some((day) => day.impressions === 0)).toBe(true);
    expect(daily.every((day) => day.clicks <= day.impressions)).toBe(true);
    expect(daily.reduce((sum, day) => sum + day.impressions, 0)).toBe(3);
    expect(daily.reduce((sum, day) => sum + day.clicks, 0)).toBe(3);
  });

  it('fails clearly when aggregate clicks exceed total impressions', () => {
    expect(() => expandDailyMeasurements('2026-05-01', '2026-08-28', 3, 4, 41, 'impossible-pair'))
      .toThrow('Daily expansion requires nonnegative safe integer totals with clicks no greater than impressions.');
  });

  it('rejects invalid caller tier ordering before model invocation', async () => {
    const { state, request } = fixture();
    const invalidRequest = { ...request, ctrBands: { ...request.ctrBands, low: { min: 0.02, max: 0.04 } } };
    await expect(runPerformanceGeneration({ state, model: new ScriptedModel([]) }, invalidRequest))
      .rejects.toMatchObject<Partial<GenerationError>>({ code: 'VALIDATION_FAILED' });
    expect(state.campaignPerformance.size).toBe(0);
  });
});

describe('performance agent', () => {
  it('uses context tools, accepts only count inputs, and traces correlated mock workflow', async () => {
    const { state, request } = fixture();
    const trace: Array<{ event: string; runId: string }> = [];
    const model = new ScriptedModel([
      { kind: 'tool', name: 'getPersonaContext', input: { reference: 'persona-1' } },
      { kind: 'tool', name: 'getProductContext', input: { reference: 'product-1' } },
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1001, clicks: 21 } },
      { kind: 'tool', name: 'performanceSummary', input: {} },
      { kind: 'tool', name: 'validatePerformance', input: {} },
      { kind: 'text', text: 'Requested synthetic performance is complete.' },
    ]);
    const result = await runPerformanceGeneration({ state, model, traceSink: (event) => trace.push({ event: event.event, runId: event.runId }) }, request);
    const record = [...state.campaignPerformance.values()][0];
    expect(result).toMatchObject({ records: 1, modelCalls: 6, toolCalls: 5, repairAttempts: 0 });
    expect(record).toMatchObject({ impressions: 1001, clicks: 21, ctr: 21 / 1001, startDate: request.startDate, endDate: request.endDate });
    expect(record.dailyMeasurements.reduce((sum, day) => sum + day.impressions, 0)).toBe(record.impressions);
    expect(record.dailyMeasurements.reduce((sum, day) => sum + day.clicks, 0)).toBe(record.clicks);
    expect(trace.every((event) => event.runId === state.runId)).toBe(true);
  });

  it('retains a valid saved aggregate after an impossible click total is rejected', async () => {
    const { state, request } = fixture();
    const model = new ScriptedModel([
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1001, clicks: 21 } },
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1001, clicks: 1002 } },
      { kind: 'tool', name: 'performanceSummary', input: {} },
      { kind: 'tool', name: 'validatePerformance', input: {} },
      { kind: 'text', text: 'The valid aggregate remains in place.' },
    ]);

    await expect(runPerformanceGeneration({ state, model }, request)).resolves.toMatchObject({ records: 1 });
    expect([...state.campaignPerformance.values()]).toHaveLength(1);
    expect([...state.campaignPerformance.values()][0]).toMatchObject({ impressions: 1001, clicks: 21 });
  });

  it('repairs a missing relationship without replacing the last valid record', async () => {
    const { state, request } = fixture();
    const secondPersonaId = '00000000-0000-4000-8000-000000000015' as RecordId;
    state.personas.set(secondPersonaId, {
      id: secondPersonaId,
      name: 'Synthetic Weekend Hikers',
      summary: 'Prefer easy-to-pack footwear for spontaneous trips.',
      interests: ['Trail Running', 'Backpacking'],
      contextualTargeting: ['Trail Running Route and Gear Guides'],
      ageGroup: '35-44',
      country: 'CA',
      productIds: [productId],
    });
    state.references.set('persona-2' as ShortReference, secondPersonaId);
    const expandedRequest = { ...request, pairs: [...request.pairs, { personaReference: 'persona-2', productReference: 'product-1', tier: 'low' as const }] };
    const model = new ScriptedModel([
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1000, clicks: 20 } },
      { kind: 'text', text: 'First relationship generated.' },
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-2', productReference: 'product-1', impressions: 1000, clicks: 5 } },
      { kind: 'tool', name: 'validatePerformance', input: {} },
      { kind: 'text', text: 'Missing relationship repaired.' },
    ]);
    const result = await runPerformanceGeneration({ state, model }, expandedRequest);
    expect(result).toMatchObject({ records: 2, repairAttempts: 1 });
    expect(state.campaignPerformance.get([...state.campaignPerformance.keys()][0])).toMatchObject({ clicks: 20 });
    expect([...state.campaignPerformance.values()].find((record) => record.personaId === secondPersonaId)).toMatchObject({ clicks: 5, ctr: 0.005 });
  });

  it('retains valid saved data when bounded repair cannot satisfy the tier band', async () => {
    const { state, request } = fixture();
    const secondPersonaId = '00000000-0000-4000-8000-000000000016' as RecordId;
    state.personas.set(secondPersonaId, {
      id: secondPersonaId,
      name: 'Synthetic Day Hikers',
      summary: 'Look for compact gear for short local trails.',
      interests: ['Trail Running', 'Backpacking'],
      contextualTargeting: ['Trail Running Route and Gear Guides'],
      ageGroup: '35-44',
      country: 'CA',
      productIds: [productId],
    });
    state.references.set('persona-2' as ShortReference, secondPersonaId);
    const expandedRequest = { ...request, pairs: [...request.pairs, { personaReference: 'persona-2', productReference: 'product-1', tier: 'medium' as const }] };
    const model = new ScriptedModel([
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1000, clicks: 20 } },
      { kind: 'text', text: 'Generation ended with an invalid tier value.' },
      { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-2', productReference: 'product-1', impressions: 1000, clicks: 1 } },
      { kind: 'text', text: 'Repair attempt ended.' },
    ]);
    await expect(runPerformanceGeneration({ state, model }, expandedRequest))
      .rejects.toMatchObject<Partial<GenerationError>>({ code: 'VALIDATION_FAILED' });
    expect(state.campaignPerformance.size).toBe(1);
    expect([...state.campaignPerformance.values()][0]).toMatchObject({ clicks: 20, ctr: 0.02 });
  });
});