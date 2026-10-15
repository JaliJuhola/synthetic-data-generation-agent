import { describe, expect, it } from 'vitest';
import type {
  AudiencePersonaRecord,
  CampaignPerformanceRecord,
  PersistedDataset,
  ProductRecord,
  RecordId,
  RunId,
} from './contracts.js';
import { calculateCtr, campaignPerformanceSchema, createPersonaSchema, personaSchema, productSchema } from './schemas.js';
import {
  applyRepairCandidates,
  assessPersonaCandidate,
  personaSimilarity,
  selectRepairTargets,
  validateCampaignPerformance,
  validateDataset,
  validateDailyConsistency,
  validatePersona,
  validateScenario,
} from './validation.js';

const id = (value: string) => value as RecordId;
const productId = id('00000000-0000-4000-8000-000000000001');
const personaId = id('00000000-0000-4000-8000-000000000002');
const performanceId = id('00000000-0000-4000-8000-000000000003');
const campaignId = id('00000000-0000-4000-8000-000000000004');

function makeProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: productId,
    name: 'Trail Camera',
    description: 'A fictional camera for outdoor trips.',
    category: 'Photography',
    price: 129.99,
    attributes: { color: 'graphite' },
    ...overrides,
  };
}

function makePersona(overrides: Partial<AudiencePersonaRecord> = {}): AudiencePersonaRecord {
  return {
    id: personaId,
    name: 'Weekend Nature Photographer',
    summary: 'Enjoys documenting local wildlife on short trips.',
    interests: ['Photography Equipment', 'Wildlife Photography'],
    contextualTargeting: ['Wildlife Watching Equipment Advice'],
    ageGroup: '25-34',
    country: 'US',
    productIds: [productId],
    ...overrides,
  };
}

function makePerformance(overrides: Partial<CampaignPerformanceRecord> = {}): CampaignPerformanceRecord {
  return {
    id: performanceId,
    campaignId,
    personaId,
    productId,
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    impressions: 10,
    clicks: 2,
    ctr: 0.2,
    dailyMeasurements: [
      { date: '2026-01-01', impressions: 4, clicks: 1 },
      { date: '2026-01-02', impressions: 6, clicks: 1 },
    ],
    ...overrides,
  };
}

function makeDataset(overrides: Partial<PersistedDataset> = {}): PersistedDataset {
  return {
    runId: '00000000-0000-4000-8000-000000000005' as RunId,
    generatedAt: '2026-01-03T00:00:00.000Z',
    targeting: {
      interests: ['Photography Equipment', 'Wildlife Photography'],
      contextualTargeting: ['Wildlife Watching Equipment Advice'],
    },
    products: [makeProduct()],
    personas: [makePersona()],
    campaignPerformance: [makePerformance()],
    ...overrides,
  };
}

const validationOptions = {
  targeting: {
    interests: ['Photography Equipment', 'Wildlife Photography'],
    contextualTargeting: ['Wildlife Watching Equipment Advice'],
  },
  supportedAgeGroups: ['25-34', '35-44'],
  supportedCountries: ['US', 'CA'],
};

describe('record schemas and validators', () => {
  it('validates product IDs and non-empty product fields', () => {
    expect(productSchema.safeParse(makeProduct()).success).toBe(true);
    expect(productSchema.safeParse(makeProduct({ id: 'not-a-uuid' as RecordId })).success).toBe(false);
  });

  it('checks targeting membership and supported age/country values', () => {
    const schema = createPersonaSchema({
      interests: validationOptions.targeting.interests,
      contextualTargeting: validationOptions.targeting.contextualTargeting,
      supportedAgeGroups: validationOptions.supportedAgeGroups,
      supportedCountries: validationOptions.supportedCountries,
    });
    expect(schema.safeParse(makePersona()).success).toBe(true);
    expect(validatePersona(makePersona({ interests: ['Photography Equipment', 'invented interest'] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ ageGroup: '17-24' }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ country: 'XX' }), validationOptions).valid).toBe(false);
  });

  it('requires exactly two interests and one contextual value, with no duplicates', () => {
    expect(validatePersona(makePersona(), validationOptions).valid).toBe(true);
    expect(personaSchema.safeParse(makePersona({ interests: ['Photography Equipment'] })).success).toBe(false);
    expect(personaSchema.safeParse(makePersona({ contextualTargeting: [] })).success).toBe(false);
    expect(validatePersona(makePersona({ interests: ['Photography Equipment'] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ interests: ['Photography Equipment', 'Wildlife Photography', 'Hiking'] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ contextualTargeting: [] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ contextualTargeting: ['Wildlife Watching Equipment Advice', 'Camera Reviews'] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ interests: ['Photography Equipment', 'Photography Equipment'] }), validationOptions).valid).toBe(false);
    expect(validatePersona(makePersona({ contextualTargeting: ['Wildlife Watching Equipment Advice', 'Wildlife Watching Equipment Advice'] }), validationOptions).valid).toBe(false);
  });

  it('checks nonnegative integer metrics, clicks <= impressions, and fractional CTR including zero impressions', () => {
    expect(calculateCtr(0, 0)).toBe(0);
    expect(calculateCtr(8, 1)).toBe(0.125);
    expect(campaignPerformanceSchema.safeParse(makePerformance()).success).toBe(true);
    expect(campaignPerformanceSchema.safeParse(makePerformance({ impressions: -1 })).success).toBe(false);
    expect(campaignPerformanceSchema.safeParse(makePerformance({ impressions: 1.5 })).success).toBe(false);
    expect(validateCampaignPerformance(makePerformance({ clicks: 11, ctr: 1.1 })).valid).toBe(false);
    expect(campaignPerformanceSchema.safeParse(makePerformance({
      impressions: 0,
      clicks: 0,
      ctr: 0,
      dailyMeasurements: [{ date: '2026-01-01', impressions: 0, clicks: 0 }],
    })).success).toBe(true);
  });

  it('reconciles daily totals and enforces unique in-range dates', () => {
    const record = makePerformance({
      dailyMeasurements: [
        { date: '2025-12-31', impressions: 4, clicks: 1 },
        { date: '2025-12-31', impressions: 5, clicks: 1 },
      ],
    });
    const issues = validateDailyConsistency(record);
    expect(issues.map((issue) => issue.code)).toContain('date_out_of_range');
    expect(issues.map((issue) => issue.code)).toContain('duplicate');
    expect(issues.map((issue) => issue.code)).toContain('impressions_mismatch');
  });
});

describe('dataset and scenario validation', () => {
  it('checks exact counts, duplicate IDs, unresolved references, and required counts', () => {
    const dataset = makeDataset({
      products: [makeProduct(), makeProduct({ id: id('00000000-0000-4000-8000-000000000006') })],
      personas: [makePersona({ productIds: [id('00000000-0000-4000-8000-000000000007')] })],
    });
    const result = validateDataset(dataset, {
      ...validationOptions,
      scenario: { exactCounts: { products: 1, personas: 1, campaignPerformance: 1 } },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('count_mismatch');
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate');
    expect(result.issues.map((issue) => issue.code)).toContain('unresolved_reference');
  });

  it('accepts a valid dataset and rejects altered authoritative targeting or duplicate personas', () => {
    expect(validateDataset(makeDataset(), validationOptions).valid).toBe(true);
    const duplicatePersona = makePersona({ id: id('00000000-0000-4000-8000-000000000014') });
    const altered = makeDataset({
      targeting: { interests: ['untrusted value'], contextualTargeting: ['Wildlife Watching Equipment Advice'] },
      personas: [makePersona(), duplicatePersona],
    });
    const result = validateDataset(altered, validationOptions);
    expect(result.issues.map((issue) => issue.code)).toContain('targeting_mismatch');
    expect(result.issues.some((issue) => issue.message.includes('Duplicate persona'))).toBe(true);
  });

  it('checks required and complete persona-product performance pairs', () => {
    const dataset = makeDataset({ campaignPerformance: [] });
    const issues = validateScenario(dataset, {
      requiredPerformancePairs: [{ personaId, productId }],
      requireEveryPersonaProductPair: true,
    });
    expect(issues.map((issue) => issue.code)).toContain('missing_pair');
  });
});

describe('persona similarity and bounded repair', () => {
  it('computes stable similarity and accepts only candidates below the supplied cutoff', () => {
    const candidate = makePersona({ id: id('00000000-0000-4000-8000-000000000008') });
    const duplicate = makePersona({ id: id('00000000-0000-4000-8000-000000000009') });
    expect(personaSimilarity(candidate, duplicate)).toBe(1);
    expect(assessPersonaCandidate(candidate, [duplicate], 0.8).accepted).toBe(false);
    expect(assessPersonaCandidate(candidate, [], 0.8).accepted).toBe(true);
    expect(assessPersonaCandidate(candidate, [], 0).accepted).toBe(true);
  });

  it('selects only invalid/missing targets within the repair bound', () => {
    const records = [makeProduct(), makeProduct({ id: id('00000000-0000-4000-8000-000000000010') })];
    expect(selectRepairTargets(records, new Set([records[1].id]), 4, 2)).toEqual([
      { kind: 'replace', id: records[1].id },
      { kind: 'missing', index: 0 },
    ]);
  });

  it('preserves valid originals and keeps an invalid original when its repair fails', () => {
    const valid = makeProduct();
    const invalid = makeProduct({ id: id('00000000-0000-4000-8000-000000000011'), name: '' });
    const targets = selectRepairTargets([valid, invalid], new Set([invalid.id]), 3, 2);
    const repair = applyRepairCandidates(
      [valid, invalid],
      new Set([invalid.id]),
      3,
      [{ target: targets[0], record: makeProduct({ id: invalid.id, name: '' }) }],
      2,
      (record) => productSchema.safeParse(record).success,
    );
    expect(repair.records[0]).toBe(valid);
    expect(repair.records[1]).toBe(invalid);
    expect(repair.records).toHaveLength(2);
    expect(repair.accepted).toBe(0);
  });

  it('replaces only targeted invalid records and appends valid missing records', () => {
    const valid = makeProduct();
    const invalid = makeProduct({ id: id('00000000-0000-4000-8000-000000000012'), name: '' });
    const targets = selectRepairTargets([valid, invalid], new Set([invalid.id]), 3, 2);
    const repaired = makeProduct({ id: invalid.id, name: 'Corrected Product' });
    const added = makeProduct({ id: id('00000000-0000-4000-8000-000000000013'), name: 'New Product' });
    const result = applyRepairCandidates(
      [valid, invalid],
      new Set([invalid.id]),
      3,
      [
        { target: targets[0], record: repaired },
        { target: targets[1], record: added },
      ],
      2,
      (record) => productSchema.safeParse(record).success,
    );
    expect(result.records).toEqual([valid, repaired, added]);
    expect(result.records[0]).toBe(valid);
    expect(result.accepted).toBe(2);
  });

  it('never replaces a valid original even if it is incorrectly marked invalid', () => {
    const valid = makeProduct();
    const targets = selectRepairTargets([valid], new Set([valid.id]), 1, 1);
    const result = applyRepairCandidates(
      [valid],
      new Set([valid.id]),
      1,
      [{ target: targets[0], record: makeProduct({ id: valid.id, name: 'Changed Product' }) }],
      1,
      (record) => productSchema.safeParse(record).success,
    );
    expect(result.records[0]).toBe(valid);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(1);
  });
});