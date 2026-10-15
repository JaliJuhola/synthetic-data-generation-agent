import { z } from 'zod';
import type {
  AudiencePersonaRecord,
  CampaignPerformanceRecord,
  DailyPerformanceMeasurement,
  PersistedDataset,
  ProductRecord,
  RecordId,
  RunId,
} from './contracts.js';

const recordIdSchema = z.string().uuid().transform((value) => value as RecordId);

export const productSchema: z.ZodType<ProductRecord> = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.string().trim().min(1),
  price: z.number().finite().nonnegative(),
  attributes: z.record(z.string(), z.string()),
});

export const personaSchema: z.ZodType<AudiencePersonaRecord> = z.object({
  id: recordIdSchema,
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  interests: z.array(z.string().trim().min(1)).length(2),
  contextualTargeting: z.array(z.string().trim().min(1)).length(1),
  ageGroup: z.string().trim().min(1),
  country: z.string().trim().min(1),
  productIds: z.array(recordIdSchema),
});

export interface PersonaSchemaOptions {
  interests: readonly string[];
  contextualTargeting: readonly string[];
  supportedAgeGroups: readonly string[];
  supportedCountries: readonly string[];
}

export function createPersonaSchema(options: PersonaSchemaOptions): z.ZodType<AudiencePersonaRecord> {
  const interestValues = new Set(options.interests);
  const contextualValues = new Set(options.contextualTargeting);
  const ageGroups = new Set(options.supportedAgeGroups);
  const countries = new Set(options.supportedCountries);

  return personaSchema.superRefine((persona, context) => {
    persona.interests.forEach((value, index) => {
      if (!interestValues.has(value)) {
        context.addIssue({ code: 'custom', path: ['interests', index], message: 'Interest is not an allowed targeting value' });
      }
    });
    persona.contextualTargeting.forEach((value, index) => {
      if (!contextualValues.has(value)) {
        context.addIssue({ code: 'custom', path: ['contextualTargeting', index], message: 'Contextual value is not an allowed targeting value' });
      }
    });
    if (!ageGroups.has(persona.ageGroup)) {
      context.addIssue({ code: 'custom', path: ['ageGroup'], message: 'Age group is not supported' });
    }
    if (!countries.has(persona.country)) {
      context.addIssue({ code: 'custom', path: ['country'], message: 'Country is not supported' });
    }
  });
}

export const dailyPerformanceMeasurementSchema: z.ZodType<DailyPerformanceMeasurement> = z.object({
  date: z.iso.date(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
}).superRefine((measurement, context) => {
  if (measurement.clicks > measurement.impressions) {
    context.addIssue({ code: 'custom', path: ['clicks'], message: 'Clicks cannot exceed impressions' });
  }
});

export function calculateCtr(impressions: number, clicks: number): number {
  return impressions === 0 ? 0 : clicks / impressions;
}

export const campaignPerformanceSchema: z.ZodType<CampaignPerformanceRecord> = z.object({
  id: recordIdSchema,
  campaignId: recordIdSchema,
  personaId: recordIdSchema,
  productId: recordIdSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  ctr: z.number().finite().min(0).max(1),
  dailyMeasurements: z.array(dailyPerformanceMeasurementSchema),
}).superRefine((record, context) => {
  if (record.clicks > record.impressions) {
    context.addIssue({ code: 'custom', path: ['clicks'], message: 'Clicks cannot exceed impressions' });
  }
  if (record.ctr !== calculateCtr(record.impressions, record.clicks)) {
    context.addIssue({ code: 'custom', path: ['ctr'], message: 'CTR must equal clicks divided by impressions, or zero when impressions are zero' });
  }
});

export const persistedDatasetSchema: z.ZodType<PersistedDataset> = z.object({
  runId: z.string().uuid().transform((value) => value as RunId),
  generatedAt: z.string().datetime(),
  targeting: z.object({
    interests: z.array(z.string()),
    contextualTargeting: z.array(z.string()),
  }),
  products: z.array(productSchema),
  personas: z.array(personaSchema),
  campaignPerformance: z.array(campaignPerformanceSchema),
});

export const scenarioRequirementsSchema = z.object({
  exactCounts: z.object({
    products: z.number().int().nonnegative().optional(),
    personas: z.number().int().nonnegative().optional(),
    campaignPerformance: z.number().int().nonnegative().optional(),
  }).optional(),
  requiredPerformancePairs: z.array(z.object({
    personaId: recordIdSchema,
    productId: recordIdSchema,
  })).optional(),
  requireEveryPersonaProductPair: z.boolean().optional(),
});

export type ScenarioRequirements = z.infer<typeof scenarioRequirementsSchema>;