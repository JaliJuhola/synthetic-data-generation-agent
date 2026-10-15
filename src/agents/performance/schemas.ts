import { z } from 'zod';

export const personaContextInputSchema = z.object({
  reference: z.string().trim().min(1).max(30).describe('Accepted short persona reference'),
});

export const productContextInputSchema = z.object({
  reference: z.string().trim().min(1).max(30).describe('Accepted short product reference'),
});

export const metricInputSchema = z.object({
  personaReference: z.string().trim().min(1).max(30).describe('Accepted short reference for a requested persona'),
  productReference: z.string().trim().min(1).max(30).describe('Accepted short reference for a requested product'),
  impressions: z.number().int().nonnegative().safe().describe('Nonnegative safe integer impression total for this relationship'),
  clicks: z.number().int().nonnegative().safe().describe('Nonnegative safe integer click total, no greater than impressions'),
}).superRefine((input, context) => {
  if (input.clicks > input.impressions) {
    context.addIssue({ code: 'custom', path: ['clicks'], message: 'Clicks cannot exceed impressions' });
  }
});