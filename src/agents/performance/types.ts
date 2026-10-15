import type { Model } from '@strands-agents/sdk';
import type {
  CampaignPerformanceRecord,
  GenerationState,
  RecordId,
  RunTraceSink,
} from '../../shared/contracts.js';
import type { selectRepairTargets } from '../../shared/validation.js';

export type PerformanceTier = 'low' | 'medium' | 'high';

export interface CtrBand {
  min: number;
  max: number;
}

export interface PerformancePairRequest {
  personaReference: string;
  productReference: string;
  tier: PerformanceTier;
}

export interface PerformanceGenerationRequest {
  startDate: string;
  endDate: string;
  seed: number;
  scenario: string;
  ctrBands: Record<PerformanceTier, CtrBand>;
  pairs: PerformancePairRequest[];
}

export interface PerformanceLimits {
  maxRecordsPerType: number;
  maxModelCalls: number;
  maxAgentTurns: number;
  maxToolCalls: number;
  maxRepairAttempts: number;
  maxPayloadBytes: number;
  maxContextTokens: number;
  maxRuntimeMs: number;
  maxCampaignDays: number;
}

export interface PerformanceAgentOptions {
  state: GenerationState;
  model: Model;
  traceSink?: RunTraceSink;
  limits?: Partial<PerformanceLimits>;
}

export interface PerformanceGenerationResult {
  runId: GenerationState['runId'];
  campaignId: RecordId;
  records: number;
  modelCalls: number;
  toolCalls: number;
  repairAttempts: number;
  durationMs: number;
}

export type RepairTarget = ReturnType<typeof selectRepairTargets<CampaignPerformanceRecord>>[number];

export interface ExpectedPair extends PerformancePairRequest {
  personaId: RecordId;
  productId: RecordId;
  key: string;
}

export interface RunControl {
  state: GenerationState;
  limits: PerformanceLimits;
  traceSink?: RunTraceSink;
  campaignId: RecordId;
  request?: PerformanceGenerationRequest;
  expectedPairs: Map<string, ExpectedPair>;
  phase: 'generation' | 'repair' | 'complete';
  repairTargets: Map<string, RepairTarget>;
  repairAttempts: number;
  modelCalls: number;
  toolCalls: number;
  contextTokensUsed: number;
  startedAt: number;
  modelStartedAt?: number;
  toolStartedAt: Map<string, number>;
}
