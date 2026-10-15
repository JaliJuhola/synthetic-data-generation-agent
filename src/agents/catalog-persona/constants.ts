import { z } from 'zod';

export const SUPPORTED_AGE_GROUPS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export const SUPPORTED_COUNTRIES = ['US', 'CA', 'GB', 'AU'] as const;
export type SupportedCountry = typeof SUPPORTED_COUNTRIES[number];
export const MAXIMUM_PERSONA_SIMILARITY = 0.8;
export const PRODUCTS_PER_GROUP = 10;
export const MAX_PRODUCTS_PER_PERSONA = 10;
export const MAX_PRODUCT_BATCH_SIZE = 5;

export interface CatalogPersonaLimits {
  maxRecordsPerType: number;
  maxModelCalls: number;
  maxAgentTurns: number;
  maxToolCalls: number;
  maxPayloadBytes: number;
  maxContextTokens: number;
  maxRuntimeMs: number;
}

export const DEFAULT_CATALOG_PERSONA_LIMITS: CatalogPersonaLimits = {
  maxRecordsPerType: 100,
  maxModelCalls: 24,
  maxAgentTurns: 24,
  maxToolCalls: 80,
  maxPayloadBytes: 65_536,
  maxContextTokens: 64_000,
  maxRuntimeMs: 240_000,
};

export const catalogPersonaLimitsSchema = z.object({
  maxRecordsPerType: z.number().int().positive(),
  maxModelCalls: z.number().int().positive(),
  maxAgentTurns: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxPayloadBytes: z.number().int().positive(),
  maxContextTokens: z.number().int().positive(),
  maxRuntimeMs: z.number().int().positive(),
});