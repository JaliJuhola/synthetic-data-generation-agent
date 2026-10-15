import {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  type Agent,
} from '@strands-agents/sdk';
import type { RunTraceEvent } from '../../shared/contracts.js';
import type { RunControl } from './tools.js';

export function emitCatalogPersonaTrace(
  control: RunControl,
  event: Omit<RunTraceEvent, 'runId' | 'occurredAt'>,
): void {
  control.traceSink?.({ runId: control.state.runId, occurredAt: new Date().toISOString(), ...event });
}

function emitUsage(event: AfterModelCallEvent, control: RunControl): void {
  const usage = event.stopData?.message.metadata?.usage;
  if (usage) control.contextTokensUsed += usage.totalTokens;
  const startedAt = control.modelStartedAt;
  control.modelStartedAt = undefined;
  emitCatalogPersonaTrace(control, {
    event: 'model.completed',
    agentName: 'catalog-persona',
    ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
    outcome: event.error ? 'error' : 'success',
    ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } } : {}),
  });
}

function returnedErrorCode(event: AfterToolCallEvent): string | undefined {
  const result = event.result.content.find((content) => content.type === 'jsonBlock');
  const value = result?.json;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.status !== 'error') return undefined;
  return typeof value.errorCode === 'string' ? value.errorCode : 'TOOL_REJECTED';
}

export function registerCatalogPersonaHooks(agent: Agent, control: RunControl): void {
  const limits = control.limits;

  agent.addHook(BeforeModelCallEvent, (event) => {
    if (Date.now() - control.startedAt >= limits.maxRuntimeMs) {
      event.cancel = 'Catalog/persona runtime limit reached.';
      return;
    }
    if (control.contextTokensUsed >= limits.maxContextTokens) {
      event.cancel = 'Catalog/persona context-token limit reached.';
      return;
    }
    if (control.modelCalls >= limits.maxModelCalls || control.modelCalls >= limits.maxAgentTurns) {
      event.cancel = 'Catalog/persona model-call or turn limit reached.';
      return;
    }
    control.modelCalls += 1;
    control.modelStartedAt = Date.now();
    emitCatalogPersonaTrace(control, { event: 'model.started', agentName: 'catalog-persona' });
  });

  agent.addHook(AfterModelCallEvent, (event) => emitUsage(event, control));

  agent.addHook(BeforeToolCallEvent, (event) => {
    if (Date.now() - control.startedAt >= limits.maxRuntimeMs) {
      event.cancel = 'Catalog/persona runtime limit reached.';
      return;
    }
    if (control.toolCalls >= limits.maxToolCalls) {
      event.cancel = 'Catalog/persona tool-call limit reached.';
      return;
    }
    control.toolCalls += 1;
    control.toolStartedAt.set(event.toolUse.toolUseId, Date.now());
    emitCatalogPersonaTrace(control, { event: 'tool.started', agentName: 'catalog-persona', toolName: event.toolUse.name });
  });

  agent.addHook(AfterToolCallEvent, (event) => {
    const toolStartedAt = control.toolStartedAt.get(event.toolUse.toolUseId);
    control.toolStartedAt.delete(event.toolUse.toolUseId);
    const errorCode = returnedErrorCode(event);
    emitCatalogPersonaTrace(control, {
      event: 'tool.completed',
      agentName: 'catalog-persona',
      toolName: event.toolUse.name,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(toolStartedAt === undefined ? {} : { durationMs: Date.now() - toolStartedAt }),
      outcome: event.error || errorCode ? 'error' : 'success',
    });
  });
}