import { Model } from '@strands-agents/sdk';
import type { BaseModelConfig, Message, ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import type { GenerationState } from '../shared/contracts.js';

type MockStep = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: unknown };

class ScriptedMockModel extends Model {
  private stepIndex = 0;

  constructor(private readonly steps: MockStep[]) { super(); }

  updateConfig(_config: BaseModelConfig): void {}
  getConfig(): BaseModelConfig { return {} as BaseModelConfig; }

  stream(_messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const step = this.steps[this.stepIndex++];
    if (!step) throw new Error('Offline mock script exhausted.');
    return this.response(step, this.stepIndex);
  }

  private async *response(step: MockStep, index: number): AsyncIterable<ModelStreamEvent> {
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if (step.kind === 'tool') {
      yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: step.name, toolUseId: `offline-${index}` } };
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

function firstTargetingValue(state: GenerationState, key: 'interests' | 'contextualTargeting'): string {
  const value = state.targeting[key][0];
  if (!value) throw new Error(`Offline smoke/eval needs at least one ${key} value.`);
  return value;
}

function firstTwoInterestValues(state: GenerationState): [string, string] {
  const values = state.targeting.interests.slice(0, 2);
  if (values.length !== 2) throw new Error('Offline smoke/eval needs at least two interest values.');
  return [values[0]!, values[1]!];
}

export function createMockAgentModels(state: GenerationState) {
  const catalogPersona = new ScriptedMockModel([
    { kind: 'tool', name: 'saveProductBatch', input: { products: [{
      name: 'Fictional Alpine Day Pack',
      description: 'A compact synthetic day pack designed for short outdoor trips.',
      category: 'Outdoor gear',
      price: 48,
      attributes: { capacity: '18L', material: 'recycled synthetic fabric' },
    }] } },
    { kind: 'text', text: 'Catalog phase complete.' },
    { kind: 'tool', name: 'getTargetingOptions', input: {} },
    { kind: 'tool', name: 'catalogSummary', input: {} },
    { kind: 'tool', name: 'savePersonaCandidate', input: {
      name: 'Synthetic Weekend Day Hikers',
      summary: 'A fictional audience interested in light equipment for local outdoor routes.',
      interests: firstTwoInterestValues(state),
      contextualTargeting: [firstTargetingValue(state, 'contextualTargeting')],
      ageGroup: '25-34',
      country: 'US',
      productReferences: ['product-1'],
    } },
    { kind: 'text', text: 'Persona phase complete.' },
  ]);
  const performance = new ScriptedMockModel([
    { kind: 'tool', name: 'getPersonaContext', input: { reference: 'persona-1' } },
    { kind: 'tool', name: 'getProductContext', input: { reference: 'product-1' } },
    { kind: 'tool', name: 'savePerformance', input: { personaReference: 'persona-1', productReference: 'product-1', impressions: 1000, clicks: 5 } },
    { kind: 'tool', name: 'performanceSummary', input: {} },
    { kind: 'tool', name: 'validatePerformance', input: {} },
    { kind: 'text', text: 'Synthetic performance phase complete.' },
  ]);
  return { catalogPersona, performance };
}

export function createMockRecommendationModel(state: GenerationState): Model {
  const record = [...state.campaignPerformance.values()][0];
  const product = record ? state.products.get(record.productId) : undefined;
  const persona = record ? state.personas.get(record.personaId) : undefined;
  if (!record || !product || !persona) throw new Error('Offline recommendation mock requires a completed campaign record.');
  const draft = {
    recommendations: [{
      productId: product.id,
      personaIds: [persona.id],
      experiment: {
        title: 'Day-pack message framing test',
        hypothesis: 'A route-planning message may be more relevant to this synthetic audience; the outcome is unknown.',
        variable: 'Product message emphasis',
        control: 'Describe compact storage capacity.',
        treatment: 'Describe lightweight packing for short routes.',
        primaryMetric: 'Click-through rate',
        durationDays: 14,
      },
      evidenceRecordIds: [record.id],
      relevanceReasoning: 'The synthetic campaign contains an observation for this product and audience; the proposed message remains untested.',
      uncertainties: ['The observed clicks do not establish a causal message effect.'],
      validationApproach: {
        successCriteria: 'Compare randomized control and treatment groups after the planned sample threshold.',
        guardrails: ['Keep delivery and attribution windows consistent.'],
        analysisMethod: 'Use a pre-registered comparison and report uncertainty intervals.',
      },
    }],
  };
  return new ScriptedMockModel([
    { kind: 'tool', name: 'getCampaignOverview', input: {} },
    { kind: 'tool', name: 'listUntestedCombinations', input: { limit: 20 } },
    { kind: 'tool', name: 'getPersonaPerformance', input: { personaId: persona.id } },
    { kind: 'tool', name: 'searchCatalog', input: { query: product.name, limit: 5 } },
    { kind: 'tool', name: 'getProductDetails', input: { productId: product.id } },
    { kind: 'tool', name: 'comparePerformance', input: { groupBy: 'product' } },
    { kind: 'tool', name: 'getMockMarketContext', input: { country: persona.country } },
    { kind: 'tool', name: 'strands_structured_output', input: draft },
  ]);
}