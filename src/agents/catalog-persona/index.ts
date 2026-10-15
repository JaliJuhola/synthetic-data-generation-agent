import {
  Agent,
  DefaultModelRetryStrategy,
  SlidingWindowConversationManager,
} from '@strands-agents/sdk';
import type { Model } from '@strands-agents/sdk';
import { z } from 'zod';
import type { GenerationState, RunTraceEvent, RunTraceSink } from '../../shared/contracts.js';
import { GenerationError } from '../../shared/contracts.js';
import {
  catalogPersonaLimitsSchema,
  DEFAULT_CATALOG_PERSONA_LIMITS,
  MAX_PRODUCTS_PER_PERSONA,
  PRODUCTS_PER_GROUP,
  SUPPORTED_COUNTRIES,
} from './constants.js';
import type { CatalogPersonaLimits, SupportedCountry } from './constants.js';
import type { RunControl } from './tools.js';
import { createCatalogPersonaTools } from './tools.js';
import { emitCatalogPersonaTrace, registerCatalogPersonaHooks } from './hooks.js';
import { catalogSystemPrompt } from './prompts/catalog-system-prompt.js';
import { completeCatalog } from './actions/catalog.js';
import { generatePersonas } from './actions/personas.js';
import type { CatalogPersonaRequest, CatalogPersonaResult } from './actions/types.js';

export interface CatalogPersonaAgentOptions {
  state: GenerationState;
  model: Model;
  traceSink?: RunTraceSink;
  limits?: Partial<CatalogPersonaLimits>;
}

function emit(control: RunControl, event: Omit<RunTraceEvent, 'runId' | 'occurredAt'>): void {
  emitCatalogPersonaTrace(control, event);
}

function assertRequestedCount(count: number, label: string, limits: CatalogPersonaLimits): void {
  if (!Number.isInteger(count) || count < 0) throw new GenerationError('VALIDATION_FAILED', `${label} count must be a nonnegative integer.`);
  if (count > limits.maxRecordsPerType) throw new GenerationError('LIMIT_EXCEEDED', `${label} count ${count} exceeds the configured maximum of ${limits.maxRecordsPerType}.`);
}

function validateRequest(request: CatalogPersonaRequest, limits: CatalogPersonaLimits): void {
  assertRequestedCount(request.products, 'Product', limits);
  if (request.groupsOf10 !== undefined) {
    const maximumGroups = limits.maxRecordsPerType / PRODUCTS_PER_GROUP;
    if (!Number.isInteger(request.groupsOf10) || request.groupsOf10 < 1 || request.groupsOf10 > maximumGroups) {
      throw new GenerationError('VALIDATION_FAILED', `Product group count must be from 1 to ${maximumGroups}.`);
    }
    if (request.products !== request.groupsOf10 * PRODUCTS_PER_GROUP) {
      throw new GenerationError('VALIDATION_FAILED', `Grouped product generation requires exactly ${PRODUCTS_PER_GROUP} products per group.`);
    }
  }
  assertRequestedCount(request.personas, 'Persona', limits);
  if (request.productsPerPersona !== undefined
    && (!Number.isInteger(request.productsPerPersona)
      || request.productsPerPersona < 1
      || request.productsPerPersona > MAX_PRODUCTS_PER_PERSONA
      || request.productsPerPersona > request.products)) {
    throw new GenerationError('VALIDATION_FAILED', `Products per persona must be from 1 to ${Math.min(MAX_PRODUCTS_PER_PERSONA, request.products)}.`);
  }
}

export function createCatalogPersonaAgent(options: CatalogPersonaAgentOptions) {
  const parsedLimits = catalogPersonaLimitsSchema.safeParse({ ...DEFAULT_CATALOG_PERSONA_LIMITS, ...options.limits });
  if (!parsedLimits.success) throw new GenerationError('VALIDATION_FAILED', 'Catalog/persona limits must be positive integers.');
  const limits = parsedLimits.data;
  const control: RunControl = {
    phase: 'catalog',
    requestedProducts: 0,
    requestedProductGroups: undefined,
    requestedPersonas: 0,
    personaAttempts: 0,
    modelCalls: 0,
    toolCalls: 0,
    contextTokensUsed: 0,
    toolStartedAt: new Map(),
    startedAt: Date.now(),
    limits,
    state: options.state,
    traceSink: options.traceSink,
  };
  const tools = createCatalogPersonaTools(control);
  const agent = new Agent({
    id: `catalog-persona-${options.state.runId}`,
    name: 'Catalog and Persona Generator',
    description: 'Generates fictional catalog products followed by synthetic advertising personas.',
    model: options.model,
    systemPrompt: catalogSystemPrompt,
    tools: Object.values(tools),
    printer: false,
    retryStrategy: new DefaultModelRetryStrategy({ maxAttempts: 2 }),
    toolExecutor: 'sequential',
    conversationManager: new SlidingWindowConversationManager({ windowSize: 12 }),
    traceAttributes: { 'generation.run_id': options.state.runId, 'generation.schema_version': '1' },
  });

  registerCatalogPersonaHooks(agent, control);

  return { agent, control, tools };
}

export async function runCatalogPersonaGeneration(
  options: CatalogPersonaAgentOptions,
  request: CatalogPersonaRequest,
): Promise<CatalogPersonaResult> {
  const parsedCountry = z.enum(SUPPORTED_COUNTRIES).safeParse(request?.country);
  if (!parsedCountry.success) {
    throw new GenerationError('VALIDATION_FAILED', `Country must be one of: ${SUPPORTED_COUNTRIES.join(', ')}.`);
  }
  const { agent, control } = createCatalogPersonaAgent(options);
  control.selectedCountry = parsedCountry.data;
  validateRequest(request, control.limits);
  control.requestedProducts = request.products;
  control.requestedProductGroups = request.groupsOf10;
  control.requestedProductsPerPersona = request.productsPerPersona;
  control.requestedPersonas = request.personas;
  const startedAt = Date.now();
  control.startedAt = startedAt;
  emit(control, { event: 'run.started', agentName: 'catalog-persona' });

  try {
    const repairAttempts = await completeCatalog(agent, control, request);
    await generatePersonas(agent, control, request);
    if (options.state.personas.size !== request.personas) {
      throw new GenerationError('LIMIT_EXCEEDED', `Persona phase incomplete: requested ${request.personas} accepted, accepted ${options.state.personas.size} after ${control.personaAttempts} candidate attempt(s); generation stopped at its configured bound.`);
    }
    control.phase = 'complete';
    const result = {
      runId: options.state.runId,
      products: options.state.products.size,
      personas: options.state.personas.size,
      repairAttempts,
      modelCalls: control.modelCalls,
      toolCalls: control.toolCalls,
      durationMs: Date.now() - startedAt,
    };
    emit(control, { event: 'run.completed', agentName: 'catalog-persona', durationMs: result.durationMs, outcome: 'success' });
    return result;
  } catch (error) {
    emit(control, { event: 'run.completed', agentName: 'catalog-persona', durationMs: Date.now() - startedAt, outcome: 'error' });
    if (error instanceof GenerationError) throw error;
    if (Date.now() - startedAt >= control.limits.maxRuntimeMs) {
      throw new GenerationError('LIMIT_EXCEEDED', `Catalog/persona generation exceeded the ${control.limits.maxRuntimeMs} ms runtime limit.`);
    }
    throw new GenerationError('GENERATION_FAILED', 'Catalog/persona model invocation failed; provider details were omitted.');
  }
}