import type { CampaignPerformanceRecord, GenerationState, RecordId, RunTraceEvent, RunTraceSink } from '../../shared/contracts.js';
import type { RecommendationLimits } from './index.js';
import type { RecommendationLogEvent, RecommendationLogger } from './logger.js';
import { isRecommendationToolName } from './logger.js';

export interface RunControl {
  state: GenerationState;
  campaignId: RecordId;
  campaignRecords: CampaignPerformanceRecord[];
  limits: RecommendationLimits;
  traceSink?: RunTraceSink;
  logger: RecommendationLogger;
  startedAt: number;
  modelStartedAt?: number;
  modelCalls: number;
  toolCalls: number;
  contextTokensUsed: number;
  toolStartedAt: Map<string, number>;
}

export function emit(control: RunControl, event: Omit<RunTraceEvent, 'runId' | 'occurredAt'>): void {
  const traceEvent: RunTraceEvent = {
    runId: control.state.runId,
    occurredAt: new Date().toISOString(),
    elapsedMs: Date.now() - control.startedAt,
    ...event,
  };
  const logEvent: RecommendationLogEvent = {
    runId: traceEvent.runId,
    event: traceEvent.event,
    ...(traceEvent.agentName === undefined ? {} : { agentName: traceEvent.agentName }),
    ...(traceEvent.toolName === undefined || !isRecommendationToolName(traceEvent.toolName) ? {} : { toolName: traceEvent.toolName }),
    ...(traceEvent.errorCode === undefined ? {} : { errorCode: traceEvent.errorCode }),
    ...(traceEvent.elapsedMs === undefined ? {} : { elapsedMs: traceEvent.elapsedMs }),
    ...(traceEvent.durationMs === undefined ? {} : { durationMs: traceEvent.durationMs }),
    ...(traceEvent.outcome === undefined ? {} : { outcome: traceEvent.outcome }),
    ...(traceEvent.usage === undefined ? {} : {
      usage: {
        inputTokens: traceEvent.usage.inputTokens,
        outputTokens: traceEvent.usage.outputTokens,
        totalTokens: traceEvent.usage.totalTokens,
      },
    }),
  };
  try {
    control.logger.log(logEvent);
  } catch {
    // Logging must not prevent lifecycle reporting or recommendation execution.
  }
  control.traceSink?.(traceEvent);
}