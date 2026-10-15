import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { CliConfiguration } from '../../configuration.js';
import { loadAzureConfig } from '../shared/config/azure.js';
import { createAzureModel } from '../shared/config/azure-model.js';
import { GenerationError } from '../shared/contracts.js';
import type { RunId } from '../shared/contracts.js';
import {
  defaultGenerationRequest,
  runGeneration,
  runRecommendationFile,
  validateGenerationRequest,
  writeEvaluationReport,
} from '../orchestration/index.js';
import type { GenerationRequest } from '../orchestration/index.js';
import { createMockAgentModels, createMockRecommendationModel } from './offline-models.js';

const evaluationReportSchema = z.object({
  status: z.enum(['completed', 'failed']),
  command: z.enum(['smoke', 'eval']),
  mode: z.literal('mock-provider; no Azure credentials or network calls'),
  generationRunId: z.string().uuid(),
  recommendationRunId: z.string().uuid(),
  counts: z.object({ products: z.number().int().nonnegative(), personas: z.number().int().nonnegative(), campaignPerformance: z.number().int().nonnegative() }),
  validation: z.object({ valid: z.boolean(), issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })) }),
  scenario: z.object({
    name: z.string(),
    status: z.enum(['passed', 'failed']),
    expectedCounts: z.object({ products: z.number(), personas: z.number(), campaignPerformance: z.number() }),
    actualCounts: z.object({ products: z.number(), personas: z.number(), campaignPerformance: z.number() }),
  }),
  execution: z.object({
    phasesCompleted: z.array(z.string()),
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    repairAttempts: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    tokenUsage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative() }).optional(),
  }),
  artifacts: z.object({ dataset: z.string(), generationReport: z.string(), recommendations: z.string() }),
});

export function printHelp(): void {
  process.stdout.write([
    'Synthetic advertising generator',
    '  npm run cli -- generate [--groups-of-10 N] [--personas N] [--products-per-persona N] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--seed N] [--scenario TEXT] [--data-dir DIR] [--output DIR]',
    '  npm run cli -- recommend <dataset.json> [--output DIR]',
    '  npm run cli -- eval [--data-dir DIR] [--output DIR]',
    '  npm run cli -- smoke [--data-dir DIR] [--output DIR]',
  ].join('\n') + '\n');
}

export async function generate(request: GenerationRequest, values: Map<string, string>, configuration: CliConfiguration): Promise<void> {
  validateGenerationRequest(request);
  const dataDirectory = resolve(values.get('data-dir') ?? configuration.paths.dataDirectory);
  const root = resolve(values.get('output') ?? configuration.paths.outputDirectory);
  const runId = randomUUID() as RunId;
  const runDirectory = resolve(root, runId);
  const result = await runGeneration({
    request,
    dataDirectory,
    outputDirectory: runDirectory,
    runId,
    createModels: () => {
      const config = loadAzureConfig();
      return { catalogPersona: createAzureModel(config), performance: createAzureModel(config) };
    },
  });
  process.stdout.write(`Generation ${result.report.runId} completed.\nDataset: ${result.datasetPath}\nReport: ${result.reportPath}\n`);
}

export async function recommend(positional: string[], values: Map<string, string>): Promise<void> {
  if (positional.length !== 1) throw new GenerationError('VALIDATION_FAILED', 'recommend requires exactly one dataset.json path.');
  const outputDirectory = resolve(values.get('output') ?? dirname(resolve(positional[0])));
  const result = await runRecommendationFile({
    inputPath: resolve(positional[0]),
    outputDirectory,
    createModel: () => createAzureModel(loadAzureConfig()),
  });
  process.stdout.write(`Recommendations for generation ${result.report.generationId} completed.\nOutput: ${result.outputPath}\nReport: ${result.reportPath}\n`);
}

export async function localEvaluation(command: 'smoke' | 'eval', values: Map<string, string>, configuration: CliConfiguration): Promise<void> {
  const dataDirectory = resolve(values.get('data-dir') ?? configuration.paths.dataDirectory);
  const root = resolve(values.get('output') ?? configuration.paths.outputDirectory);
  const runId = randomUUID() as RunId;
  const outputDirectory = resolve(root, runId);
  const defaults = defaultGenerationRequest('US');
  const request: GenerationRequest = {
    ...defaults,
    products: 1,
    personas: 1,
    startDate: defaults.startDate,
    endDate: defaults.startDate,
    scenario: command === 'smoke' ? 'Offline CLI wiring smoke scenario.' : 'Offline evaluation of one synthetic product-persona campaign pair.',
  };
  const generated = await runGeneration({
    request,
    dataDirectory,
    outputDirectory,
    runId,
    createModels: (state) => createMockAgentModels(state),
  });
  const recommendation = await runRecommendationFile({
    inputPath: generated.datasetPath!,
    outputDirectory,
    createModel: (state) => createMockRecommendationModel(state),
  });
  const evaluation = evaluationReportSchema.parse({
    status: generated.report.status,
    command,
    mode: 'mock-provider; no Azure credentials or network calls',
    generationRunId: generated.report.runId,
    recommendationRunId: recommendation.report.recommendationRunId,
    counts: generated.report.counts,
    validation: generated.report.validation,
    scenario: {
      name: request.scenario,
      status: generated.report.validation.valid ? 'passed' : 'failed',
      expectedCounts: { products: request.products, personas: request.personas, campaignPerformance: request.products * request.personas },
      actualCounts: generated.report.counts,
    },
    execution: {
      phasesCompleted: [...generated.report.execution.phasesCompleted, 'recommendation'],
      modelCalls: generated.report.execution.modelCalls + recommendation.report.modelCalls,
      toolCalls: generated.report.execution.toolCalls + recommendation.report.toolCalls,
      repairAttempts: generated.report.execution.repairAttempts,
      durationMs: generated.report.execution.durationMs + recommendation.report.durationMs,
      tokenUsage: generated.report.execution.tokenUsage && recommendation.report.tokenUsage ? {
        inputTokens: generated.report.execution.tokenUsage.inputTokens + recommendation.report.tokenUsage.inputTokens,
        outputTokens: generated.report.execution.tokenUsage.outputTokens + recommendation.report.tokenUsage.outputTokens,
        totalTokens: generated.report.execution.tokenUsage.totalTokens + recommendation.report.tokenUsage.totalTokens,
      } : undefined,
    },
    artifacts: { dataset: generated.datasetPath, generationReport: generated.reportPath, recommendations: recommendation.outputPath },
  });
  const evaluationPath = await writeEvaluationReport(outputDirectory, runId, evaluation);
  process.stdout.write(`${command} passed with mock providers.\nEvaluation: ${evaluationPath}\nDataset: ${generated.datasetPath}\nRecommendations: ${recommendation.outputPath}\n`);
}