import type { Agent } from '@strands-agents/sdk';
import type { RunControl } from '../tools.js';
import { personaSystemPrompt } from '../prompts/persona-system-prompt.js';
import type { CatalogPersonaRequest } from './types.js';

export async function generatePersonas(
  agent: Agent,
  control: RunControl,
  request: CatalogPersonaRequest,
): Promise<void> {
  control.phase = 'persona';
  agent.messages = [];
  agent.systemPrompt = personaSystemPrompt;
  if (request.personas === 0) return;

  const productCountInstruction = request.productsPerPersona === undefined
    ? ''
    : `Each persona must reference exactly ${request.productsPerPersona} products from the accepted catalog.\n`;
  const prompt = `Create exactly ${request.personas} accepted synthetic audience personas.
${productCountInstruction}
Propose one candidate per tool call.
Begin by retrieving targeting options and compact catalog references.`;
  await agent.invoke(prompt, {
    invocationState: { runId: control.state.runId, phase: 'persona' },
    limits: {
      turns: Math.max(1, control.limits.maxAgentTurns - control.modelCalls),
      totalTokens: Math.max(1, control.limits.maxContextTokens - control.contextTokensUsed),
    },
    cancelSignal: AbortSignal.timeout(Math.max(1, control.limits.maxRuntimeMs - (Date.now() - control.startedAt))),
  });
}