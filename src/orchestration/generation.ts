import { randomUUID } from 'node:crypto';
import type { GenerationState, PersistedDataset, RunId, RunTraceEvent } from '../shared/contracts.js';
import { GenerationError } from '../shared/contracts.js';
import { createConsoleRunTraceLogger } from '../shared/logger.js';
import type { RunTraceLogger } from '../shared/logger.js';
import { persistedDatasetSchema } from '../shared/schemas.js';
import { validateDataset } from '../shared/validation.js';
import {
  runCatalogPersonaGeneration,
} from '../agents/catalog-persona/index.js';
import { SUPPORTED_AGE_GROUPS, SUPPORTED_COUNTRIES } from '../agents/catalog-persona/constants.js';
import { runPerformanceGeneration, type PerformanceTier } from '../agents/performance/index.js';
import { CATALOG_PERSONA_TOOL_NAMES } from '../agents/catalog-persona/tools.js';
import { PERFORMANCE_TOOL_NAMES } from '../agents/performance/tools.js';
import type { AgentModels, GenerationRequest, GenerationResult } from './contracts.js';
import { createGenerationState, loadTargetingValues, referenceFor, writeJson } from './io.js';
import { validateGenerationRequest } from './request.js';
import { safeGenerationLogEvent, summarizeTrace } from './trace.js';
import { generationReportSchema } from './contracts.js';

export async function runGeneration(options: {
  request: GenerationRequest;
  dataDirectory: string;
  outputDirectory: string;
  runId?: RunId;
  logger?: RunTraceLogger;
  createModels: (state: GenerationState) => Pick<AgentModels, 'catalogPersona' | 'performance'>;
}): Promise<GenerationResult> {
  validateGenerationRequest(options.request);
  const startedAt = new Date();
  const runId = options.runId ?? randomUUID() as RunId;
  const events: RunTraceEvent[] = [];
  const registeredToolNames = new Set([
    ...Object.values(CATALOG_PERSONA_TOOL_NAMES),
    ...Object.values(PERFORMANCE_TOOL_NAMES),
  ]);
  const logger = options.logger ?? createConsoleRunTraceLogger(registeredToolNames);
  const traceSink = (event: RunTraceEvent) => {
    const tracedEvent = { ...event, elapsedMs: Date.now() - startedAt.getTime() };
    events.push(tracedEvent);
    try {
      logger.log(safeGenerationLogEvent(tracedEvent, registeredToolNames));
    } catch {
    }
  };
  const phasesCompleted: string[] = [];
  let state: GenerationState | undefined;
  let failure: { code: string; message: string } | undefined;
  let validation = { valid: false, issues: [] as Array<{ path: string; code: string; message: string }> };
  let repairAttempts = 0;
  let dataset: PersistedDataset | undefined;
  try {
    const targeting = await loadTargetingValues(options.dataDirectory);
    const generationState = createGenerationState(runId, targeting, startedAt);
    state = generationState;
    const models = options.createModels(generationState);
    const catalogResult = await runCatalogPersonaGeneration({ state: generationState, model: models.catalogPersona, traceSink }, {
      products: options.request.products,
      groupsOf10: options.request.groupsOf10,
      personas: options.request.personas,
      productsPerPersona: options.request.productsPerPersona,
      country: options.request.country,
      scenario: options.request.scenario,
    });
    if (catalogResult.products !== options.request.products || catalogResult.personas !== options.request.personas) {
      throw new GenerationError('GENERATION_FAILED', 'Catalog/persona phase reported incomplete requested counts.');
    }
    phasesCompleted.push('catalog-persona');

    const pairs = [...generationState.personas.values()].flatMap((persona) => [...generationState.products.values()].map((product) => ({
      personaReference: referenceFor(generationState, persona.id, 'persona'),
      productReference: referenceFor(generationState, product.id, 'product'),
    })));
    const tiers: PerformanceTier[] = ['low', 'medium', 'high'];
    const performanceResult = await runPerformanceGeneration({ state: generationState, model: models.performance, traceSink }, {
      startDate: options.request.startDate,
      endDate: options.request.endDate,
      seed: options.request.seed,
      scenario: options.request.scenario,
      ctrBands: options.request.ctrBands,
      pairs: pairs.map((pair, index) => ({ ...pair, tier: tiers[index % tiers.length] })),
    });
    if (performanceResult.records !== pairs.length) throw new GenerationError('GENERATION_FAILED', 'Performance phase reported incomplete requested relationships.');
    repairAttempts = catalogResult.repairAttempts + performanceResult.repairAttempts;
    phasesCompleted.push('performance');

    const generatedAt = new Date().toISOString();
    dataset = persistedDatasetSchema.parse({
      runId,
      generatedAt,
      targeting,
      products: [...generationState.products.values()],
      personas: [...generationState.personas.values()],
      campaignPerformance: [...generationState.campaignPerformance.values()],
    });
    validation = validateDataset(dataset, {
      targeting,
      supportedAgeGroups: SUPPORTED_AGE_GROUPS,
      supportedCountries: SUPPORTED_COUNTRIES,
      scenario: {
        exactCounts: {
          products: options.request.products,
          personas: options.request.personas,
          campaignPerformance: pairs.length,
        },
        requireEveryPersonaProductPair: true,
      },
    });
    if (!validation.valid) throw new GenerationError('VALIDATION_FAILED', `Final dataset validation failed with ${validation.issues.length} issue(s).`);
  } catch (error) {
    failure = error instanceof GenerationError
      ? { code: error.code, message: error.message }
      : { code: 'GENERATION_FAILED', message: 'Generation failed; provider details were omitted.' };
  }

  const completedAt = new Date();
  const counts = {
    products: state?.products.size ?? 0,
    personas: state?.personas.size ?? 0,
    campaignPerformance: state?.campaignPerformance.size ?? 0,
  };
  const traceStats = summarizeTrace(events);
  const report = generationReportSchema.parse({
    status: failure ? 'failed' : 'completed',
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    request: options.request,
    counts,
    validation,
    execution: {
      phasesCompleted,
      modelCalls: traceStats.modelCalls,
      toolCalls: traceStats.toolCalls,
      repairAttempts,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      retryPolicy: 'strands-default-throttling-only; maxAttempts=2',
      ...(traceStats.tokenUsage ? { tokenUsage: traceStats.tokenUsage } : {}),
    },
    dataSemantics: {
      performance: 'synthetic-historic-measurements',
      marketContext: 'fictional-context-not-historical-measurement',
      recommendations: 'hypotheses-not-proven-outcomes',
    },
    ...(failure ? { failure } : {}),
  });

  let reportToWrite = report;
  let datasetPath: string | undefined;
  if (!failure && dataset) {
    try {
      datasetPath = await writeJson(options.outputDirectory, 'dataset.json', dataset, runId);
    } catch (error) {
      const outputError = error instanceof GenerationError
        ? error
        : new GenerationError('OUTPUT_FAILED', 'Could not persist the generated dataset.');
      failure = { code: outputError.code, message: outputError.message };
      reportToWrite = generationReportSchema.parse({ ...report, status: 'failed', failure });
    }
  }
  const reportPath = await writeJson(options.outputDirectory, 'generation-report.json', reportToWrite, runId);
  if (failure) throw new GenerationError(failure.code as ConstructorParameters<typeof GenerationError>[0], `${failure.message} Report: ${reportPath}`);
  return { dataset: dataset!, report: reportToWrite, datasetPath: datasetPath!, reportPath };
}