import { z } from 'zod';

const dateSchema = z.iso.date();

const observedEvidenceSchema = z.object({
  kind: z.literal('synthetic-performance-observation'),
  performanceRecordId: z.string().uuid(),
  productId: z.string().uuid(),
  personaId: z.string().uuid(),
  startDate: dateSchema,
  endDate: dateSchema,
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  ctr: z.number().finite().min(0).max(1),
});

export const recommendationOutputSchema = z.object({
  campaignId: z.string().uuid(),
  recommendations: z.array(z.object({
    product: z.object({
      productId: z.string().uuid(),
      name: z.string().min(1),
      category: z.string().min(1),
    }),
    audience: z.object({
      personaIds: z.array(z.string().uuid()).min(1),
      description: z.string().min(1),
    }),
    experiment: z.object({
      title: z.string().min(1),
      hypothesis: z.string().min(1),
      outcomeStatus: z.literal('unknown'),
      variable: z.string().min(1),
      control: z.string().min(1),
      treatment: z.string().min(1),
      primaryMetric: z.string().min(1),
      durationDays: z.number().int().positive(),
    }),
    observedEvidence: z.array(observedEvidenceSchema).min(1),
    relevanceReasoning: z.string().min(1),
    marketContext: z.array(z.object({
      kind: z.literal('mock-market-context'),
      historicalMeasurement: z.literal(false),
      date: dateSchema,
      country: z.string().length(2),
      season: z.enum(['spring', 'summer', 'autumn', 'winter']),
      weather: z.string().min(1),
      holidays: z.array(z.string()),
      shoppingPeriods: z.array(z.string()),
      fictionalTrends: z.array(z.string()),
    })).min(1),
    uncertainties: z.array(z.string().min(1)).min(1),
    validationApproach: z.object({
      successCriteria: z.string().min(1),
      guardrails: z.array(z.string().min(1)).min(1),
      analysisMethod: z.string().min(1),
    }),
  })).max(5),
});

export const recommendationDraftSchema = z.object({
  recommendations: z.array(z.object({
    productId: z.string().uuid(),
    personaIds: z.array(z.string().uuid()).min(1),
    experiment: z.object({
      title: z.string().min(1).max(160),
      hypothesis: z.string().min(1).max(800),
      variable: z.string().min(1).max(300),
      control: z.string().min(1).max(300),
      treatment: z.string().min(1).max(300),
      primaryMetric: z.string().min(1).max(160),
      durationDays: z.number().int().positive().max(366),
    }),
    evidenceRecordIds: z.array(z.string().uuid()).min(1).max(20),
    relevanceReasoning: z.string().min(1).max(1_000),
    uncertainties: z.array(z.string().min(1).max(400)).min(1).max(10),
    validationApproach: z.object({
      successCriteria: z.string().min(1).max(500),
      guardrails: z.array(z.string().min(1).max(300)).min(1).max(10),
      analysisMethod: z.string().min(1).max(500),
    }),
  })).max(5),
});

export const getPersonaPerformanceInputSchema = z.object({
  personaId: z.string().uuid().describe('Persona UUID from this campaign or catalog'),
});

export const searchCatalogInputSchema = z.object({
  query: z.string().trim().min(1).max(120).describe('Catalog text to search'),
  limit: z.number().int().min(1).max(10).default(5).describe('Maximum matches'),
});

export const getProductDetailsInputSchema = z.object({
  productId: z.string().uuid().describe('Product UUID from catalog search or campaign'),
});

export const listUntestedCombinationsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50).describe('Maximum untested combinations to return'),
});

export const comparePerformanceInputSchema = z.object({
  groupBy: z.enum(['product', 'persona']).describe('Observed grouping dimension'),
});

export const getMockMarketContextInputSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/).describe('Uppercase country code from a persona'),
});