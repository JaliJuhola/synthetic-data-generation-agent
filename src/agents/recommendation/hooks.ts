import {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
} from '@strands-agents/sdk';
import type { Agent } from '@strands-agents/sdk';
import { emit } from './internal.js';
import type { RunControl } from './internal.js';

export function attachRecommendationHooks(agent: Agent, control: RunControl): void {
  const limits = control.limits;
  agent.addHook(BeforeModelCallEvent, (event) => {
    if (Date.now() - control.startedAt >= limits.maxRuntimeMs) event.cancel = 'Recommendation runtime limit reached.';
    else if (control.contextTokensUsed >= limits.maxContextTokens) event.cancel = 'Recommendation context-token limit reached.';
    else if (control.modelCalls >= limits.maxModelCalls || control.modelCalls >= limits.maxAgentTurns) event.cancel = 'Recommendation model-call or turn limit reached.';
    else {
      control.modelCalls += 1;
      control.modelStartedAt = Date.now();
      emit(control, { event: 'model.started', agentName: 'recommendation' });
    }
  });
  agent.addHook(AfterModelCallEvent, (event) => {
    const usage = event.stopData?.message.metadata?.usage;
    if (usage) control.contextTokensUsed += usage.totalTokens;
    const startedAt = control.modelStartedAt;
    control.modelStartedAt = undefined;
    emit(control, {
      event: 'model.completed',
      agentName: 'recommendation',
      ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
      outcome: event.error ? 'error' : 'success',
      ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } } : {}),
    });
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    if (Date.now() - control.startedAt >= limits.maxRuntimeMs) event.cancel = 'Recommendation runtime limit reached.';
    else if (control.toolCalls >= limits.maxToolCalls) event.cancel = 'Recommendation tool-call limit reached.';
    else {
      control.toolCalls += 1;
      control.toolStartedAt.set(event.toolUse.toolUseId, Date.now());
      emit(control, { event: 'tool.started', agentName: 'recommendation', toolName: event.toolUse.name });
    }
  });
  agent.addHook(AfterToolCallEvent, (event) => {
    const startedAt = control.toolStartedAt.get(event.toolUse.toolUseId);
    control.toolStartedAt.delete(event.toolUse.toolUseId);
    emit(control, {
      event: 'tool.completed',
      agentName: 'recommendation',
      toolName: event.toolUse.name,
      ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
      outcome: event.error ? 'error' : 'success',
    });
  });
}