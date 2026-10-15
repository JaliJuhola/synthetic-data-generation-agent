import { z } from 'zod';
import { GenerationError } from '../shared/contracts.js';
import { MAX_PRODUCTS_PER_PERSONA, PRODUCTS_PER_GROUP, SUPPORTED_COUNTRIES } from '../agents/catalog-persona/constants.js';
import type { SupportedCountry } from '../agents/catalog-persona/constants.js';
import { DEFAULT_CTR_BANDS, MAX_CAMPAIGN_DAYS, MAX_RECORDS_PER_TYPE } from './constants.js';
import type { GenerationRequest } from './contracts.js';

export function defaultGenerationRequest(country: SupportedCountry, now = new Date()): GenerationRequest {
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(Date.parse(`${startDate}T00:00:00.000Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
  return { products: 20, personas: 5, country, startDate, endDate, seed: 41, scenario: 'Fictional online-store campaign for a seasonal product discovery test.', ctrBands: DEFAULT_CTR_BANDS };
}

export function validateGenerationRequest(request: GenerationRequest): void {
  if (!z.enum(SUPPORTED_COUNTRIES).safeParse(request.country).success) {
    throw new GenerationError('VALIDATION_FAILED', `Country must be one of: ${SUPPORTED_COUNTRIES.join(', ')}.`);
  }
  if (request.groupsOf10 !== undefined) {
    if (!Number.isInteger(request.groupsOf10) || request.groupsOf10 < 1) {
      throw new GenerationError('VALIDATION_FAILED', 'Product group count must be a positive integer.');
    }
    if (request.products !== request.groupsOf10 * PRODUCTS_PER_GROUP) {
      throw new GenerationError('VALIDATION_FAILED', `Grouped generation requires exactly ${PRODUCTS_PER_GROUP} products per group.`);
    }
  }
  if (!Number.isInteger(request.products) || request.products < 1 || request.products > MAX_RECORDS_PER_TYPE) {
    throw new GenerationError('VALIDATION_FAILED', `Product count must be an integer from 1 to ${MAX_RECORDS_PER_TYPE}.`);
  }
  if (!Number.isInteger(request.personas) || request.personas < 1 || request.personas > MAX_RECORDS_PER_TYPE) {
    throw new GenerationError('VALIDATION_FAILED', `Persona count must be an integer from 1 to ${MAX_RECORDS_PER_TYPE}.`);
  }
  if (request.productsPerPersona !== undefined
    && (!Number.isInteger(request.productsPerPersona)
      || request.productsPerPersona < 1
      || request.productsPerPersona > MAX_PRODUCTS_PER_PERSONA
      || request.productsPerPersona > request.products)) {
    throw new GenerationError('VALIDATION_FAILED', `Products per persona must be from 1 to ${Math.min(MAX_PRODUCTS_PER_PERSONA, request.products)}.`);
  }
  if (request.products * request.personas > MAX_RECORDS_PER_TYPE) {
    throw new GenerationError('LIMIT_EXCEEDED', `The requested product/persona matrix exceeds ${MAX_RECORDS_PER_TYPE} performance records.`);
  }
  if (!Number.isSafeInteger(request.seed) || request.seed < 0) throw new GenerationError('VALIDATION_FAILED', 'Seed must be a nonnegative safe integer.');
  if (!request.scenario.trim() || request.scenario.length > 500) throw new GenerationError('VALIDATION_FAILED', 'Scenario must contain 1 to 500 characters.');
  const date = (value: string) => z.iso.date().safeParse(value).success;
  if (!date(request.startDate) || !date(request.endDate) || request.startDate > request.endDate) {
    throw new GenerationError('VALIDATION_FAILED', 'Campaign dates must be valid ISO dates in start-to-end order.');
  }
  const days = Math.floor((Date.parse(`${request.endDate}T00:00:00Z`) - Date.parse(`${request.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_CAMPAIGN_DAYS) throw new GenerationError('LIMIT_EXCEEDED', `Campaign window exceeds ${MAX_CAMPAIGN_DAYS} days.`);
  const bands = request.ctrBands;
  for (const band of Object.values(bands)) {
    if (!Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min < 0 || band.max > 1 || band.min > band.max) {
      throw new GenerationError('VALIDATION_FAILED', 'CTR bands must be fractional ranges between 0 and 1.');
    }
  }
  if (!(bands.low.max < bands.medium.min && bands.medium.max < bands.high.min)) {
    throw new GenerationError('VALIDATION_FAILED', 'CTR bands must be ordered and non-overlapping: low, medium, high.');
  }
}