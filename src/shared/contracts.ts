import type {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  ModelStreamUpdateEvent,
  Usage,
} from '@strands-agents/sdk';

export type RunId = string & { readonly __runId: unique symbol };
export type RecordId = string & { readonly __recordId: unique symbol };
export type ShortReference = string & { readonly __shortReference: unique symbol };

export interface ProductRecord {
  id: RecordId;
  name: string;
  description: string;
  category: string;
  price: number;
  attributes: Record<string, string>;
}

export interface AudiencePersonaRecord {
  id: RecordId;
  name: string;
  summary: string;
  interests: string[];
  contextualTargeting: string[];
  ageGroup: string;
  country: string;
  productIds: RecordId[];
}

export interface DailyPerformanceMeasurement {
  date: string;
  impressions: number;
  clicks: number;
}

export interface CampaignPerformanceRecord {
  id: RecordId;
  campaignId: RecordId;
  personaId: RecordId;
  productId: RecordId;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  ctr: number;
  dailyMeasurements: DailyPerformanceMeasurement[];
}

export interface TargetingValues {
  interests: readonly string[];
  contextualTargeting: readonly string[];
}

export interface GenerationState {
  readonly runId: RunId;
  readonly startedAt: Date;
  readonly targeting: TargetingValues;
  readonly references: Map<ShortReference, RecordId>;
  products: Map<RecordId, ProductRecord>;
  personas: Map<RecordId, AudiencePersonaRecord>;
  campaignPerformance: Map<RecordId, CampaignPerformanceRecord>;
}

export interface PersistedDataset {
  runId: RunId;
  generatedAt: string;
  targeting: TargetingValues;
  products: ProductRecord[];
  personas: AudiencePersonaRecord[];
  campaignPerformance: CampaignPerformanceRecord[];
}

export type GenerationErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'TARGETING_FILE_MISSING'
  | 'LIMIT_EXCEEDED'
  | 'GENERATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'OUTPUT_FAILED';

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

export type ModelTokenUsage = Pick<Usage, 'inputTokens' | 'outputTokens' | 'totalTokens'>;

export type RunTraceEventName =
  | 'run.started'
  | 'run.completed'
  | 'model.started'
  | 'model.completed'
  | 'tool.started'
  | 'tool.completed';

export interface RunTraceEvent {
  runId: RunId;
  occurredAt: string;
  elapsedMs?: number;
  event: RunTraceEventName;
  agentName?: string;
  toolName?: string;
  errorCode?: string;
  durationMs?: number;
  outcome?: 'success' | 'error';
  usage?: ModelTokenUsage;
}

export type RunTraceSink = (event: RunTraceEvent) => void;