import type { RunTraceEvent } from '../shared/contracts.js';
import type { RunTraceLogEvent } from '../shared/logger.js';

export function summarizeTrace(events: readonly RunTraceEvent[]) {
  const usage = events.flatMap((event) => event.usage ? [event.usage] : []);
  return {
    modelCalls: events.filter((event) => event.event === 'model.started').length,
    toolCalls: events.filter((event) => event.event === 'tool.started').length,
    ...(usage.length ? {
      tokenUsage: {
        inputTokens: usage.reduce((total, value) => total + value.inputTokens, 0),
        outputTokens: usage.reduce((total, value) => total + value.outputTokens, 0),
        totalTokens: usage.reduce((total, value) => total + value.totalTokens, 0),
      },
    } : {}),
  };
}

const generationAgentNames = new Set(['catalog-persona', 'performance']);

export function safeGenerationLogEvent(event: RunTraceEvent, registeredToolNames: ReadonlySet<string>): RunTraceLogEvent {
  return {
    runId: event.runId,
    event: event.event,
    ...(event.agentName === undefined || !generationAgentNames.has(event.agentName) ? {} : { agentName: event.agentName }),
    ...(event.toolName === undefined || !registeredToolNames.has(event.toolName) ? {} : { toolName: event.toolName }),
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.usage === undefined ? {} : {
      usage: {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        totalTokens: event.usage.totalTokens,
      },
    }),
  };
}