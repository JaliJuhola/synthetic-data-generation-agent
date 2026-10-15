import { z } from 'zod';
import type {
  AudiencePersonaRecord,
  CampaignPerformanceRecord,
  PersistedDataset,
  ProductRecord,
  RecordId,
  TargetingValues,
} from './contracts.js';
import {
  calculateCtr,
  campaignPerformanceSchema,
  createPersonaSchema,
  persistedDatasetSchema,
  productSchema,
  scenarioRequirementsSchema,
  type ScenarioRequirements,
} from './schemas.js';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface DatasetValidationOptions {
  targeting: TargetingValues;
  supportedAgeGroups: readonly string[];
  supportedCountries: readonly string[];
  scenario?: ScenarioRequirements;
}

function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { valid: issues.length === 0, issues };
}

function duplicateIssues(values: readonly string[], path: string, label: string): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].map((value) => ({
    path,
    code: 'duplicate',
    message: `Duplicate ${label}: ${value}`,
  }));
}

export function validateProduct(value: unknown): ValidationResult {
  const parsed = productSchema.safeParse(value);
  return result(parsed.success ? [] : zodIssues(parsed.error));
}

export function validatePersona(
  value: unknown,
  options: DatasetValidationOptions,
  knownProductIds?: ReadonlySet<RecordId>,
): ValidationResult {
  const schema = createPersonaSchema({
    interests: options.targeting.interests,
    contextualTargeting: options.targeting.contextualTargeting,
    supportedAgeGroups: options.supportedAgeGroups,
    supportedCountries: options.supportedCountries,
  });
  const parsed = schema.safeParse(value);
  if (!parsed.success) return result(zodIssues(parsed.error));

  const issues = duplicateIssues(parsed.data.interests, 'interests', 'interest')
    .concat(duplicateIssues(parsed.data.contextualTargeting, 'contextualTargeting', 'contextual targeting value'))
    .concat(duplicateIssues(parsed.data.productIds, 'productIds', 'product reference'));
  if (knownProductIds) {
    parsed.data.productIds.forEach((id, index) => {
      if (!knownProductIds.has(id)) {
        issues.push({ path: `productIds.${index}`, code: 'unresolved_reference', message: 'Product reference does not resolve to a catalog product' });
      }
    });
  }
  return result(issues);
}

export function validateCampaignPerformance(value: unknown): ValidationResult {
  const parsed = campaignPerformanceSchema.safeParse(value);
  if (!parsed.success) return result(zodIssues(parsed.error));
  return result(validateDailyConsistency(parsed.data));
}

export function validateDailyConsistency(record: CampaignPerformanceRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.startDate > record.endDate) {
    issues.push({ path: 'startDate', code: 'invalid_date_range', message: 'Campaign start date must not be after its end date' });
  }

  const dailyDates = new Set<string>();
  let impressions = 0;
  let clicks = 0;
  for (const [index, day] of record.dailyMeasurements.entries()) {
    if (dailyDates.has(day.date)) {
      issues.push({ path: `dailyMeasurements.${index}.date`, code: 'duplicate', message: 'Daily measurement dates must be unique' });
    }
    dailyDates.add(day.date);
    if (day.date < record.startDate || day.date > record.endDate) {
      issues.push({ path: `dailyMeasurements.${index}.date`, code: 'date_out_of_range', message: 'Daily measurement must fall within the campaign date range' });
    }
    impressions += day.impressions;
    clicks += day.clicks;
  }
  if (impressions !== record.impressions) {
    issues.push({ path: 'dailyMeasurements', code: 'impressions_mismatch', message: 'Daily impressions do not reconcile with campaign impressions' });
  }
  if (clicks !== record.clicks) {
    issues.push({ path: 'dailyMeasurements', code: 'clicks_mismatch', message: 'Daily clicks do not reconcile with campaign clicks' });
  }
  if (record.ctr !== calculateCtr(record.impressions, record.clicks)) {
    issues.push({ path: 'ctr', code: 'ctr_mismatch', message: 'CTR is not the computed campaign fraction' });
  }
  return issues;
}

export function personaSimilarity(left: AudiencePersonaRecord, right: AudiencePersonaRecord): number {
  const leftFeatures = personaFeatures(left);
  const rightFeatures = personaFeatures(right);
  const union = new Set([...leftFeatures, ...rightFeatures]);
  if (union.size === 0) return 1;
  let intersectionSize = 0;
  for (const feature of leftFeatures) {
    if (rightFeatures.has(feature)) intersectionSize += 1;
  }
  return intersectionSize / union.size;
}

export interface PersonaCandidateAssessment {
  accepted: boolean;
  maximumSimilarity: number;
  mostSimilarPersonaId?: RecordId;
}

export function assessPersonaCandidate(
  candidate: AudiencePersonaRecord,
  existing: readonly AudiencePersonaRecord[],
  maximumAllowedSimilarity: number,
): PersonaCandidateAssessment {
  if (!Number.isFinite(maximumAllowedSimilarity) || maximumAllowedSimilarity < 0 || maximumAllowedSimilarity > 1) {
    throw new RangeError('maximumAllowedSimilarity must be between 0 and 1');
  }
  let maximumSimilarity = 0;
  let mostSimilarPersonaId: RecordId | undefined;
  for (const persona of existing) {
    const similarity = personaSimilarity(candidate, persona);
    if (similarity > maximumSimilarity) {
      maximumSimilarity = similarity;
      mostSimilarPersonaId = persona.id;
    }
  }
  return {
    accepted: existing.length === 0 || maximumSimilarity < maximumAllowedSimilarity,
    maximumSimilarity,
    ...(mostSimilarPersonaId ? { mostSimilarPersonaId } : {}),
  };
}

function personaFeatures(persona: AudiencePersonaRecord): Set<string> {
  const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');
  const tokens = (value: string) => value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set([
    ...tokens(persona.name).map((value) => `text:${value}`),
    ...tokens(persona.summary).map((value) => `text:${value}`),
    ...persona.interests.map((value) => `interest:${normalize(value)}`),
    ...persona.contextualTargeting.map((value) => `context:${normalize(value)}`),
    ...persona.productIds.map((value) => `product:${value}`),
    `age:${normalize(persona.ageGroup)}`,
    `country:${normalize(persona.country)}`,
  ]);
}

export function validateScenario(
  dataset: Pick<PersistedDataset, 'products' | 'personas' | 'campaignPerformance'>,
  scenario: ScenarioRequirements,
): ValidationIssue[] {
  const requirements = scenarioRequirementsSchema.safeParse(scenario);
  if (!requirements.success) return zodIssues(requirements.error);
  const issues: ValidationIssue[] = [];
  const counts = {
    products: dataset.products.length,
    personas: dataset.personas.length,
    campaignPerformance: dataset.campaignPerformance.length,
  };
  for (const [kind, expected] of Object.entries(requirements.data.exactCounts ?? {})) {
    if (expected !== undefined && counts[kind as keyof typeof counts] !== expected) {
      issues.push({ path: kind, code: 'count_mismatch', message: `Expected exactly ${expected} ${kind}, found ${counts[kind as keyof typeof counts]}` });
    }
  }

  const representedPairs = new Set(dataset.campaignPerformance.map((record) => `${record.personaId}:${record.productId}`));
  for (const [index, pair] of (requirements.data.requiredPerformancePairs ?? []).entries()) {
    if (!representedPairs.has(`${pair.personaId}:${pair.productId}`)) {
      issues.push({ path: `requiredPerformancePairs.${index}`, code: 'missing_pair', message: 'Required persona-product performance pair is missing' });
    }
  }
  if (requirements.data.requireEveryPersonaProductPair) {
    for (const persona of dataset.personas) {
      for (const product of dataset.products) {
        if (!representedPairs.has(`${persona.id}:${product.id}`)) {
          issues.push({ path: 'campaignPerformance', code: 'missing_pair', message: `Missing performance for persona ${persona.id} and product ${product.id}` });
        }
      }
    }
  }
  return issues;
}

export function validateDataset(value: unknown, options: DatasetValidationOptions): ValidationResult {
  const parsed = persistedDatasetSchema.safeParse(value);
  if (!parsed.success) return result(zodIssues(parsed.error));

  const dataset = parsed.data;
  const issues: ValidationIssue[] = [];
  for (const key of ['interests', 'contextualTargeting'] as const) {
    const actual = dataset.targeting[key];
    const expected = options.targeting[key];
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      issues.push({ path: `targeting.${key}`, code: 'targeting_mismatch', message: 'Dataset targeting must match the authoritative values and order' });
    }
  }
  const productIds = new Set(dataset.products.map((record) => record.id));
  const personaIds = new Set(dataset.personas.map((record) => record.id));
  const allRecordIds = [
    ...dataset.products.map((record) => record.id),
    ...dataset.personas.map((record) => record.id),
    ...dataset.campaignPerformance.map((record) => record.id),
  ];
  issues.push(...duplicateIssues(allRecordIds, 'records', 'record ID'));
  issues.push(...duplicateIssues(dataset.products.map((record) => record.name.trim().toLocaleLowerCase('en-US')), 'products', 'product name'));
  issues.push(...duplicateIssues(
    dataset.personas.map((persona) => JSON.stringify([...personaFeatures(persona)].sort())),
    'personas',
    'persona',
  ));
  issues.push(...duplicateIssues(dataset.campaignPerformance.map((record) => `${record.campaignId}:${record.personaId}:${record.productId}`), 'campaignPerformance', 'campaign persona-product record'));

  dataset.personas.forEach((persona, index) => {
    const validation = validatePersona(persona, options, productIds);
    issues.push(...validation.issues.map((issue) => ({ ...issue, path: `personas.${index}.${issue.path}` })));
  });
  dataset.campaignPerformance.forEach((record, index) => {
    const validation = validateCampaignPerformance(record);
    issues.push(...validation.issues.map((issue) => ({ ...issue, path: `campaignPerformance.${index}.${issue.path}` })));
    if (!personaIds.has(record.personaId)) {
      issues.push({ path: `campaignPerformance.${index}.personaId`, code: 'unresolved_reference', message: 'Campaign persona reference does not resolve' });
    }
    if (!productIds.has(record.productId)) {
      issues.push({ path: `campaignPerformance.${index}.productId`, code: 'unresolved_reference', message: 'Campaign product reference does not resolve' });
    }
  });
  issues.push(...validateScenario(dataset, options.scenario ?? {}));
  return result(issues);
}

export interface RepairTarget {
  kind: 'replace' | 'missing';
  id?: string;
  index?: number;
}

export interface RepairCandidate<T> {
  target: RepairTarget;
  record: T;
}

export interface RepairResult<T> {
  records: T[];
  attempts: number;
  accepted: number;
  rejected: number;
}

export function selectRepairTargets<T extends { id: string }>(
  records: readonly T[],
  invalidIds: ReadonlySet<string>,
  expectedCount: number,
  maxAttempts: number,
): RepairTarget[] {
  assertNonnegativeInteger(expectedCount, 'expectedCount');
  assertNonnegativeInteger(maxAttempts, 'maxAttempts');
  const targets: RepairTarget[] = [];
  for (const record of records) {
    if (invalidIds.has(record.id)) targets.push({ kind: 'replace', id: record.id });
  }
  const missingCount = Math.max(0, expectedCount - records.length);
  for (let index = 0; index < missingCount; index += 1) {
    targets.push({ kind: 'missing', index });
  }
  return targets.slice(0, maxAttempts);
}

export function applyRepairCandidates<T extends { id: string }>(
  originals: readonly T[],
  invalidIds: ReadonlySet<string>,
  expectedCount: number,
  candidates: readonly RepairCandidate<T>[],
  maxAttempts: number,
  isValid: (record: T) => boolean,
): RepairResult<T> {
  const boundedTargets = selectRepairTargets(originals, invalidIds, expectedCount, maxAttempts);
  const eligible = new Set(boundedTargets.map(repairTargetKey));
  const records = [...originals];
  const originalById = new Map(originals.map((record, index) => [record.id, index]));
  const targetCandidates = new Map<string, T>();
  let rejected = 0;
  let attempts = 0;

  for (const candidate of candidates.slice(0, maxAttempts)) {
    attempts += 1;
    const key = repairTargetKey(candidate.target);
    if (!eligible.has(key) || targetCandidates.has(key)) {
      rejected += 1;
      continue;
    }
    if (!isValid(candidate.record)) {
      rejected += 1;
      continue;
    }

    if (candidate.target.kind === 'replace') {
      const existingIndex = originalById.get(candidate.target.id ?? '');
      if (
        existingIndex === undefined
        || !invalidIds.has(candidate.target.id ?? '')
        || isValid(originals[existingIndex])
        || candidate.record.id !== candidate.target.id
      ) {
        rejected += 1;
        continue;
      }
      records[existingIndex] = candidate.record;
    } else {
      if (originalById.has(candidate.record.id) || records.some((record) => record.id === candidate.record.id)) {
        rejected += 1;
        continue;
      }
      records.push(candidate.record);
    }
    targetCandidates.set(key, candidate.record);
  }
  return { records, attempts, accepted: targetCandidates.size, rejected };
}

function repairTargetKey(target: RepairTarget): string {
  return target.kind === 'replace' ? `replace:${target.id ?? ''}` : `missing:${target.index ?? -1}`;
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative integer`);
}