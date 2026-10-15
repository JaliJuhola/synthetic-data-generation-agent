import { randomUUID } from 'node:crypto';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type {
  AudiencePersonaRecord,
  CampaignPerformanceRecord,
  ProductRecord,
  RecordId,
  ShortReference,
} from '../../shared/contracts.js';
import { applyRepairCandidates, validateCampaignPerformance } from '../../shared/validation.js';
import { calculateCtr } from '../../shared/schemas.js';
import { expandDailyMeasurements } from './daily-measurements.js';
import { metricInputSchema, personaContextInputSchema, productContextInputSchema } from './schemas.js';
import type { ExpectedPair, RunControl } from './types.js';

export const PERFORMANCE_TOOL_NAMES = {
  getPersonaContext: 'getPersonaContext',
  getProductContext: 'getProductContext',
  savePerformance: 'savePerformance',
  performanceSummary: 'performanceSummary',
  validatePerformance: 'validatePerformance',
} as const;

const statusResultSchema = z.object({
  status: z.enum(['success', 'error']),
  errorCode: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

function success<T extends Record<string, unknown>>(data: T) {
  return statusResultSchema.parse({ status: 'success', ...data });
}

function failure(errorCode: string, message: string, details?: Record<string, unknown>) {
  return statusResultSchema.parse({ status: 'error', errorCode, message, ...details });
}

function pairKey(personaId: RecordId, productId: RecordId): string {
  return `${personaId}:${productId}`;
}

function validationMessage(issues: readonly { path: string; message: string }[]): string {
  return issues.slice(0, 8).map((issue) => `${issue.path || 'record'}: ${issue.message}`).join('; ');
}

function getRecordForPair(control: RunControl, expected: ExpectedPair): CampaignPerformanceRecord | undefined {
  return [...control.state.campaignPerformance.values()].find((record) => record.personaId === expected.personaId && record.productId === expected.productId);
}

function validateRecordForPair(control: RunControl, record: CampaignPerformanceRecord, expected: ExpectedPair) {
  const issues = validateCampaignPerformance(record).issues.map(({ path, message }) => ({ path, message }));
  const band = control.request?.ctrBands[expected.tier];
  if (record.campaignId !== control.campaignId) issues.push({ path: 'campaignId', message: 'Record does not belong to this campaign run' });
  if (band && (record.ctr < band.min || record.ctr > band.max)) {
    issues.push({ path: 'ctr', message: `CTR ${record.ctr} is outside the assigned ${expected.tier} band [${band.min}, ${band.max}]` });
  }
  return issues;
}

function personSummary(reference: string, persona: AudiencePersonaRecord) {
  return {
    reference,
    name: persona.name,
    motivation: persona.summary,
    interests: persona.interests,
    contextualTargeting: persona.contextualTargeting,
    ageGroup: persona.ageGroup,
    country: persona.country,
  };
}

function productSummary(reference: string, product: ProductRecord) {
  return {
    reference,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    attributes: product.attributes,
  };
}

function referenceId(state: RunControl['state'], reference: string): RecordId | undefined {
  const id = state.references.get(reference as ShortReference);
  return id && (state.personas.has(id) || state.products.has(id)) ? id : undefined;
}

function pairFromReferences(control: RunControl, personaReference: string, productReference: string) {
  const personaId = referenceId(control.state, personaReference);
  if (!personaId || !control.state.personas.has(personaId)) return { error: failure('UNRESOLVED_PERSONA_REFERENCE', `Persona reference "${personaReference}" is not an accepted persona reference.`) } as const;
  const productId = referenceId(control.state, productReference);
  if (!productId || !control.state.products.has(productId)) return { error: failure('UNRESOLVED_PRODUCT_REFERENCE', `Product reference "${productReference}" is not an accepted product reference.`) } as const;
  const expected = control.expectedPairs.get(pairKey(personaId, productId));
  if (!expected) return { error: failure('UNREQUESTED_PAIR', 'This persona-product relationship was not requested for the current scenario.') } as const;
  return { expected } as const;
}

function performanceValidation(control: RunControl) {
  const issues: Array<{ path: string; message: string }> = [];
  const invalidIds = new Set<string>();
  const represented = new Set<string>();
  for (const [mapId, record] of control.state.campaignPerformance) {
    const key = pairKey(record.personaId, record.productId);
    const expected = control.expectedPairs.get(key);
    const recordIssues = expected
      ? validateRecordForPair(control, record, expected)
      : [{ path: 'pair', message: 'Record is not a requested persona-product relationship' }];
    if (mapId !== record.id) recordIssues.push({ path: 'id', message: 'State key does not match performance record ID' });
    if (represented.has(key)) recordIssues.push({ path: 'pair', message: 'Duplicate persona-product performance record' });
    represented.add(key);
    if (recordIssues.length > 0) {
      invalidIds.add(record.id);
      issues.push(...recordIssues.map((issue) => ({ path: `campaignPerformance.${record.id}.${issue.path}`, message: issue.message })));
    }
  }
  for (const expected of control.expectedPairs.values()) {
    if (!represented.has(expected.key)) issues.push({ path: `campaignPerformance.${expected.key}`, message: 'Requested persona-product performance record is missing' });
  }
  return { valid: issues.length === 0, issues, invalidIds };
}

export { performanceValidation, validationMessage };

export function createPerformanceTools(control: RunControl) {
  const getPersonaContext = tool({
    name: PERFORMANCE_TOOL_NAMES.getPersonaContext,
    description: 'Read one accepted persona by short reference and return concise motivation and targeting context. Returns an actionable error for unknown references.',
    inputSchema: personaContextInputSchema,
    callback: ({ reference }) => {
      const id = referenceId(control.state, reference);
      const persona = id ? control.state.personas.get(id) : undefined;
      if (!persona) return failure('UNRESOLVED_PERSONA_REFERENCE', `Persona reference "${reference}" is not accepted.`);
      const context = personSummary(reference, persona);
      if (Buffer.byteLength(JSON.stringify(context), 'utf8') > control.limits.maxPayloadBytes) return failure('PAYLOAD_LIMIT', 'Persona context exceeds the configured payload limit.');
      return success({ persona: context });
    },
  });

  const getProductContext = tool({
    name: PERFORMANCE_TOOL_NAMES.getProductContext,
    description: 'Read one accepted product by short reference and return concise positioning, attributes, and price. Returns an actionable error for unknown references.',
    inputSchema: productContextInputSchema,
    callback: ({ reference }) => {
      const id = referenceId(control.state, reference);
      const product = id ? control.state.products.get(id) : undefined;
      if (!product) return failure('UNRESOLVED_PRODUCT_REFERENCE', `Product reference "${reference}" is not accepted.`);
      const context = productSummary(reference, product);
      if (Buffer.byteLength(JSON.stringify(context), 'utf8') > control.limits.maxPayloadBytes) return failure('PAYLOAD_LIMIT', 'Product context exceeds the configured payload limit.');
      return success({ product: context });
    },
  });

  const savePerformance = tool({
    name: PERFORMANCE_TOOL_NAMES.savePerformance,
    description: 'Validate and save integer impression/click totals for one requested persona-product reference pair. TypeScript assigns IDs/dates, expands daily totals, and computes fractional CTR; invalid, duplicate, out-of-tier, or out-of-bound inputs return actionable errors.',
    inputSchema: metricInputSchema,
    callback: (input) => {
      if (control.phase === 'complete') return failure('PHASE_CLOSED', 'Performance generation is complete.');
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') > control.limits.maxPayloadBytes) return failure('PAYLOAD_LIMIT', 'Performance totals exceed the configured payload limit.');
      const resolved = pairFromReferences(control, input.personaReference, input.productReference);
      if ('error' in resolved) return resolved.error;
      const { expected } = resolved;
      const isRepair = control.phase === 'repair';
      const target = isRepair ? control.repairTargets.get(expected.key) : undefined;
      if (isRepair && !target) return failure('REPAIR_TARGET_NOT_ALLOWED', 'Only relationships listed in the bounded repair request may be saved.');

      const existingForPair = getRecordForPair(control, expected);
      if (existingForPair && (!target || target.kind !== 'replace' || target.id !== existingForPair.id)) {
        return failure('DUPLICATE_PAIR', 'This requested persona-product relationship already has a saved record and cannot be overwritten.');
      }
      const ctr = calculateCtr(input.impressions, input.clicks);
      const band = control.request?.ctrBands[expected.tier];
      if (band && (ctr < band.min || ctr > band.max)) {
        return failure('TIER_BAND_MISMATCH', `Computed CTR ${ctr} is outside this pair's ${expected.tier} band [${band.min}, ${band.max}]; revise integer totals.`);
      }

      const id = target?.kind === 'replace' ? target.id as RecordId : randomUUID() as RecordId;
      const request = control.request;
      if (!request) return failure('PHASE_CLOSED', 'Performance request is not initialized.');
      const dailyMeasurements = expandDailyMeasurements(request.startDate, request.endDate, input.impressions, input.clicks, request.seed, expected.key);
      const record: CampaignPerformanceRecord = {
        id,
        campaignId: control.campaignId,
        personaId: expected.personaId,
        productId: expected.productId,
        startDate: request.startDate,
        endDate: request.endDate,
        impressions: input.impressions,
        clicks: input.clicks,
        ctr,
        dailyMeasurements,
      };
      const recordIssues = validateRecordForPair(control, record, expected);
      if (recordIssues.length > 0) return failure('VALIDATION_FAILED', validationMessage(recordIssues));

      if (target) {
        const originals = [...control.state.campaignPerformance.values()];
        const invalidIds = new Set<string>(target.kind === 'replace' ? [target.id ?? ''] : []);
        const repair = applyRepairCandidates(
          originals,
          invalidIds,
          control.expectedPairs.size,
          [{ target, record }],
          control.limits.maxRepairAttempts,
          (candidate) => {
            const candidateExpected = control.expectedPairs.get(pairKey(candidate.personaId, candidate.productId));
            return Boolean(candidateExpected && validateRecordForPair(control, candidate, candidateExpected).length === 0);
          },
        );
        if (repair.accepted !== 1) return failure('REPAIR_REJECTED', 'Repair candidate did not target an invalid or missing record; existing data was retained.');
      }
      control.state.campaignPerformance.set(record.id, record);
      return success({
        saved: { personaReference: expected.personaReference, productReference: expected.productReference, tier: expected.tier, impressions: record.impressions, clicks: record.clicks, ctr: record.ctr },
        progress: { saved: control.state.campaignPerformance.size, requested: control.expectedPairs.size },
      });
    },
  });

  const performanceSummary = tool({
    name: PERFORMANCE_TOOL_NAMES.performanceSummary,
    description: 'Return requested/saved relationship counts and concise per-tier completion counts without full performance payloads.',
    inputSchema: z.object({}),
    callback: () => {
      const byTier = { low: 0, medium: 0, high: 0 };
      for (const expected of control.expectedPairs.values()) if (getRecordForPair(control, expected)) byTier[expected.tier] += 1;
      return success({ saved: control.state.campaignPerformance.size, requested: control.expectedPairs.size, byTier });
    },
  });

  const validatePerformance = tool({
    name: PERFORMANCE_TOOL_NAMES.validatePerformance,
    description: 'Check requested relationship coverage, references, metric invariants, assigned CTR bands, and exact daily reconciliation; returns concise issues without mutating state.',
    inputSchema: z.object({}),
    callback: () => {
      const validation = performanceValidation(control);
      return validation.valid
        ? success({ valid: true, records: control.state.campaignPerformance.size, issues: [] })
        : { ...failure('VALIDATION_FAILED', `Performance validation found ${validation.issues.length} issue(s).`), issues: validation.issues.slice(0, 10) };
    },
  });

  return { getPersonaContext, getProductContext, savePerformance, performanceSummary, validatePerformance };
}
