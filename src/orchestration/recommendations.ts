import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { Model } from '@strands-agents/sdk';
import { GenerationError } from '../shared/contracts.js';
import type { GenerationState, PersistedDataset, RunId, RunTraceEvent } from '../shared/contracts.js';
import { persistedDatasetSchema } from '../shared/schemas.js';
import { validateDataset } from '../shared/validation.js';
import { SUPPORTED_AGE_GROUPS, SUPPORTED_COUNTRIES } from '../agents/catalog-persona/constants.js';
import { runRecommendations } from '../agents/recommendation/index.js';
import { MAX_DATASET_BYTES } from './constants.js';
import type { RecommendationFile, RecommendationReport } from './contracts.js';
import { recommendationFileSchema, recommendationReportSchema } from './contracts.js';
import { createGenerationState, writeJson } from './io.js';
import { summarizeTrace } from './trace.js';

export async function runRecommendationFile(options: {
  inputPath: string;
  outputDirectory: string;
  createModel: (state: GenerationState) => Model;
}): Promise<{ output: RecommendationFile; report: RecommendationReport; outputPath: string; reportPath: string }> {
  let contents: string;
  let fileSize: number;
  try {
    fileSize = (await stat(options.inputPath)).size;
  } catch {
    throw new GenerationError('OUTPUT_FAILED', `Could not read dataset file ${options.inputPath}.`);
  }
  if (fileSize > MAX_DATASET_BYTES) throw new GenerationError('LIMIT_EXCEEDED', `Dataset file ${options.inputPath} exceeds the ${MAX_DATASET_BYTES}-byte limit.`);
  try {
    contents = await readFile(options.inputPath, 'utf8');
  } catch {
    throw new GenerationError('OUTPUT_FAILED', `Could not read dataset file ${options.inputPath}.`);
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_DATASET_BYTES) throw new GenerationError('LIMIT_EXCEEDED', `Dataset file ${options.inputPath} exceeds the ${MAX_DATASET_BYTES}-byte limit.`);
  let dataset: PersistedDataset;
  try {
    dataset = persistedDatasetSchema.parse(JSON.parse(contents));
  } catch {
    throw new GenerationError('VALIDATION_FAILED', `Dataset file ${options.inputPath} is not valid JSON in the required dataset schema.`);
  }
  const validation = validateDataset(dataset, {
    targeting: dataset.targeting,
    supportedAgeGroups: SUPPORTED_AGE_GROUPS,
    supportedCountries: SUPPORTED_COUNTRIES,
  });
  if (!validation.valid) throw new GenerationError('VALIDATION_FAILED', `Dataset file ${options.inputPath} failed validation with ${validation.issues.length} issue(s).`);
  const campaignIds = new Set(dataset.campaignPerformance.map((record) => record.campaignId));
  if (campaignIds.size > 1) {
    throw new GenerationError('VALIDATION_FAILED', `Dataset file ${options.inputPath} contains ${campaignIds.size} campaign IDs; recommendation import requires a single campaign.`);
  }
  const campaignId = dataset.campaignPerformance[0]?.campaignId;
  if (!campaignId) throw new GenerationError('VALIDATION_FAILED', 'Dataset contains no campaign performance records to recommend from.');

  const recommendationRunId = randomUUID() as RunId;
  const state = createGenerationState(recommendationRunId, dataset.targeting, new Date());
  for (const product of dataset.products) state.products.set(product.id, product);
  for (const persona of dataset.personas) state.personas.set(persona.id, persona);
  for (const record of dataset.campaignPerformance) state.campaignPerformance.set(record.id, record);
  const before = JSON.stringify({ products: [...state.products], personas: [...state.personas], performance: [...state.campaignPerformance] });
  const events: RunTraceEvent[] = [];
  const result = await runRecommendations({ state, model: options.createModel(state), traceSink: (event) => events.push(event) }, { campaignId });
  const after = JSON.stringify({ products: [...state.products], personas: [...state.personas], performance: [...state.campaignPerformance] });
  if (before !== after) throw new GenerationError('VALIDATION_FAILED', 'Recommendation execution mutated the loaded dataset state.');

  const output = recommendationFileSchema.parse({
    generationId: dataset.runId,
    recommendationRunId,
    generatedAt: new Date().toISOString(),
    campaignId,
    provenance: {
      observedEvidence: 'synthetic-historic-measurements',
      marketContext: 'fictional-context-not-historical-measurement',
      interpretation: 'recommendations-are-hypotheses-not-proven-outcomes',
    },
    recommendations: result.recommendations,
  });
  const usage = summarizeTrace(events);
  const report = recommendationReportSchema.parse({
    generationId: dataset.runId,
    recommendationRunId,
    campaignId,
    recommendationCount: result.recommendations.length,
    modelCalls: usage.modelCalls,
    toolCalls: usage.toolCalls,
    durationMs: result.durationMs,
    ...(usage.tokenUsage ? { tokenUsage: usage.tokenUsage } : {}),
  });
  const outputPath = await writeJson(options.outputDirectory, 'recommendations.json', output, recommendationRunId);
  const reportPath = await writeJson(options.outputDirectory, 'recommendation-report.json', report, recommendationRunId);
  return { output, report, outputPath, reportPath };
}