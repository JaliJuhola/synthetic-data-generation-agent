import { z } from 'zod';
import { MAX_PRODUCT_BATCH_SIZE, MAX_PRODUCTS_PER_PERSONA } from './constants.js';

export const productCandidateSchema = z.object({
  name: z.string().trim().min(1).max(120).describe('Fictional product name without a real brand'),
  description: z.string().trim().min(1).max(1_000).describe('Concise fictional product description'),
  category: z.string().trim().min(1).max(100).describe('Product category'),
  price: z.number().finite().nonnegative().describe('Realistic price for the product category; finite and nonnegative'),
  attributes: z.record(z.string(), z.string().max(200)).describe('Compact product attributes'),
}).refine((product) => Object.keys(product.attributes).length <= 20, 'A product may contain at most 20 attributes');

export const productBatchSchema = z.object({
  products: z.array(productCandidateSchema).min(1).max(MAX_PRODUCT_BATCH_SIZE)
    .describe('One batch of up to five fictional products'),
});

export const catalogQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).describe('Text to find in product names, categories, descriptions, or attributes'),
  limit: z.number().int().min(1).max(10).default(5).describe('Maximum concise matches to return'),
});

export const personaCandidateSchema = z.object({
  name: z.string().trim().min(1).max(120).describe('Descriptive synthetic audience label, not an individual name'),
  summary: z.string().trim().min(1).max(500).describe('Fictional audience archetype summary'),
  interests: z.array(z.string().trim().min(1).max(120)).length(2).describe('Exactly 2 values from getTargetingOptions.interests'),
  contextualTargeting: z.array(z.string().trim().min(1).max(160)).length(1).describe('Exactly 1 value from getTargetingOptions.contextualTargeting'),
  ageGroup: z.string().trim().min(1).max(20).describe('One locally supported age group'),
  productReferences: z.array(z.string().trim().min(1).max(30)).min(1).max(MAX_PRODUCTS_PER_PERSONA)
    .describe('Short references returned by the catalog tools'),
});