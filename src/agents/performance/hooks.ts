import {
  AfterModelCallEvent,
  AfterToolCallEvent,
  Agent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
} from '@strands-agents/sdk';
import type { RunTraceEvent } from '../../shared/contracts.js';
import type { RunControl } from './types.js';

type Emit = (event: Omit<RunTraceEvent, 'runId' | 'occurredAt'>) => void;

export function registerPerformanceHooks(agent: Agent, control: RunControl, emit: Emit): void {
  agent.addHook(BeforeModelCallEvent, (event) => {
    if (Date.now() - control.startedAt >= control.limits.maxRuntimeMs) {
      event.cancel = 'Performance generation runtime limit reached.';
      return;
    }
    if (control.contextTokensUsed >= control.limits.maxContextTokens) {
      event.cancel = 'Performance context-token limit reached.';
      return;
    }
    if (control.modelCalls >= control.limits.maxModelCalls || control.modelCalls >= control.limits.maxAgentTurns) {
      event.cancel = 'Performance model-call or turn limit reached.';
      return;
    }
    control.modelCalls += 1;
    control.modelStartedAt = Date.now();
    emit({ event: 'model.started', agentName: 'performance' });
  });
  agent.addHook(AfterModelCallEvent, (event) => {
    const usage = event.stopData?.message.metadata?.usage;
    if (usage) control.contextTokensUsed += usage.totalTokens;
    const startedAt = control.modelStartedAt;
    control.modelStartedAt = undefined;
    emit({
      event: 'model.completed',
      agentName: 'performance',
      ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
      outcome: event.error ? 'error' : 'success',
      ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } } : {}),
    });
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    if (Date.now() - control.startedAt >= control.limits.maxRuntimeMs) {
      event.cancel = 'Performance generation runtime limit reached.';
      return;
    }
    if (control.toolCalls >= control.limits.maxToolCalls) {
      event.cancel = 'Performance tool-call limit reached.';
      return;
    }
    control.toolCalls += 1;
    control.toolStartedAt.set(event.toolUse.toolUseId, Date.now());
    emit({ event: 'tool.started', agentName: 'performance', toolName: event.toolUse.name });
  });
  agent.addHook(AfterToolCallEvent, (event) => {
    const startedAt = control.toolStartedAt.get(event.toolUse.toolUseId);
    control.toolStartedAt.delete(event.toolUse.toolUseId);
    emit({
      event: 'tool.completed',
      agentName: 'performance',
      toolName: event.toolUse.name,
      ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
      outcome: event.error ? 'error' : 'success',
    });
  });
}
