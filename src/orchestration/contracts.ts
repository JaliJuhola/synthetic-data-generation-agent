import type { Model } from '@strands-agents/sdk';
import { z } from 'zod';
import type { PersistedDataset, RecordId, RunId } from '../shared/contracts.js';
import { SUPPORTED_COUNTRIES } from '../agents/catalog-persona/constants.js';
import type { SupportedCountry } from '../agents/catalog-persona/constants.js';
import type { CtrBand, PerformanceTier } from '../agents/performance/index.js';
import { recommendationOutputSchema } from '../agents/recommendation/index.js';

export interface GenerationRequest {
  products: number;
  groupsOf10?: number;
  personas: number;
  productsPerPersona?: number;
  country: SupportedCountry;
  startDate: string;
  endDate: string;
  seed: number;
  scenario: string;
  ctrBands: Record<PerformanceTier, CtrBand>;
}

export interface AgentModels {
  catalogPersona: Model;
  performance: Model;
}

export interface GenerationReport {
  status: 'completed' | 'failed';
  runId: RunId;
  startedAt: string;
  completedAt: string;
  request: GenerationRequest;
  counts: { products: number; personas: number; campaignPerformance: number };
  validation: { valid: boolean; issues: Array<{ path: string; code: string; message: string }> };
  execution: {
    phasesCompleted: string[];
    modelCalls: number;
    toolCalls: number;
    repairAttempts: number;
    durationMs: number;
    retryPolicy: 'strands-default-throttling-only; maxAttempts=2';
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
  dataSemantics: {
    performance: 'synthetic-historic-measurements';
    marketContext: 'fictional-context-not-historical-measurement';
    recommendations: 'hypotheses-not-proven-outcomes';
  };
  failure?: { code: string; message: string };
}

export const generationReportSchema: z.ZodType<GenerationReport> = z.object({
  status: z.enum(['completed', 'failed']),
  runId: z.string().uuid().transform((value) => value as RunId),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  request: z.object({
    products: z.number().int().nonnegative(),
    groupsOf10: z.number().int().positive().optional(),
    personas: z.number().int().nonnegative(),
    productsPerPersona: z.number().int().positive().optional(),
    country: z.enum(SUPPORTED_COUNTRIES),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    seed: z.number().int().nonnegative().safe(),
    scenario: z.string().max(500),
    ctrBands: z.object({
      low: z.object({ min: z.number(), max: z.number() }),
      medium: z.object({ min: z.number(), max: z.number() }),
      high: z.object({ min: z.number(), max: z.number() }),
    }),
  }),
  counts: z.object({ products: z.number().int().nonnegative(), personas: z.number().int().nonnegative(), campaignPerformance: z.number().int().nonnegative() }),
  validation: z.object({
    valid: z.boolean(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
  }),
  execution: z.object({
    phasesCompleted: z.array(z.string()),
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    repairAttempts: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    retryPolicy: z.literal('strands-default-throttling-only; maxAttempts=2'),
    tokenUsage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative() }).optional(),
  }),
  dataSemantics: z.object({
    performance: z.literal('synthetic-historic-measurements'),
    marketContext: z.literal('fictional-context-not-historical-measurement'),
    recommendations: z.literal('hypotheses-not-proven-outcomes'),
  }),
  failure: z.object({ code: z.string(), message: z.string() }).optional(),
});

export interface GenerationResult {
  dataset?: PersistedDataset;
  report: GenerationReport;
  datasetPath?: string;
  reportPath: string;
}

export const recommendationFileSchema = z.object({
  generationId: z.string().uuid(),
  recommendationRunId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  campaignId: z.string().uuid(),
  provenance: z.object({
    observedEvidence: z.literal('synthetic-historic-measurements'),
    marketContext: z.literal('fictional-context-not-historical-measurement'),
    interpretation: z.literal('recommendations-are-hypotheses-not-proven-outcomes'),
  }),
  recommendations: recommendationOutputSchema.shape.recommendations,
});

export type RecommendationFile = z.infer<typeof recommendationFileSchema>;

export interface RecommendationReport {
  generationId: string;
  recommendationRunId: RunId;
  campaignId: RecordId;
  recommendationCount: number;
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export const recommendationReportSchema: z.ZodType<RecommendationReport> = z.object({
  generationId: z.string().uuid(),
  recommendationRunId: z.string().uuid().transform((value) => value as RunId),
  campaignId: z.string().uuid().transform((value) => value as RecordId),
  recommendationCount: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  tokenUsage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), totalTokens: z.number().nonnegative() }).optional(),
});