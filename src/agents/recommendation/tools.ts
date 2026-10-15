import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { AudiencePersonaRecord, CampaignPerformanceRecord, ProductRecord, RecordId } from '../../shared/contracts.js';
import type { RunControl } from './internal.js';
import { recommendationToolNames } from './logger.js';
import { createMockMarketContext } from './market-context.js';
import {
  comparePerformanceInputSchema,
  getMockMarketContextInputSchema,
  getPersonaPerformanceInputSchema,
  getProductDetailsInputSchema,
  listUntestedCombinationsInputSchema,
  searchCatalogInputSchema,
} from './schemas.js';

const statusResultSchema = z.object({
  status: z.enum(['success', 'error']),
  errorCode: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

const failure = (errorCode: string, message: string) => statusResultSchema.parse({ status: 'error', errorCode, message });

function success<T extends Record<string, unknown>>(control: RunControl, data: T) {
  const result = statusResultSchema.parse({ status: 'success', ...data });
  return Buffer.byteLength(JSON.stringify(result), 'utf8') > control.limits.maxPayloadBytes
    ? failure('PAYLOAD_LIMIT', 'Read-only tool result exceeds the configured payload limit.')
    : result;
}

function productSummary(product: ProductRecord) {
  return { productId: product.id, name: product.name, category: product.category, price: product.price, description: product.description };
}

function personaSummary(persona: AudiencePersonaRecord) {
  return {
    personaId: persona.id,
    name: persona.name,
    summary: persona.summary,
    interests: persona.interests,
    contextualTargeting: persona.contextualTargeting,
    country: persona.country,
  };
}

export function campaignEndDate(records: readonly CampaignPerformanceRecord[]): string {
  return records.reduce((date, row) => row.endDate > date ? row.endDate : date, records[0].endDate);
}

export function observedRecord(record: CampaignPerformanceRecord) {
  return {
    kind: 'synthetic-performance-observation' as const,
    performanceRecordId: record.id,
    productId: record.productId,
    personaId: record.personaId,
    startDate: record.startDate,
    endDate: record.endDate,
    impressions: record.impressions,
    clicks: record.clicks,
    ctr: record.ctr,
  };
}

export function createRecommendationTools(control: RunControl) {
  const getCampaignOverview = tool({
    name: recommendationToolNames.getCampaignOverview,
    description: 'Read the selected validated campaign summary and concise persona/product coverage; returns an actionable error if no records match the requested campaign.',
    inputSchema: z.object({}),
    callback: () => control.campaignRecords.length === 0
      ? failure('NO_CAMPAIGN_EVIDENCE', 'No campaign has been initialized for this recommendation run.')
      : success(control, {
        campaignId: control.campaignId,
        records: control.campaignRecords.length,
        dateRange: {
          startDate: control.campaignRecords.reduce((date, row) => row.startDate < date ? row.startDate : date, control.campaignRecords[0].startDate),
          endDate: campaignEndDate(control.campaignRecords),
        },
        productIds: [...new Set(control.campaignRecords.map((row) => row.productId))],
        personaIds: [...new Set(control.campaignRecords.map((row) => row.personaId))],
      }),
  });

  const getPersonaPerformance = tool({
    name: recommendationToolNames.getPersonaPerformance,
    description: 'Read one persona and their observed records in this campaign; rejects personas with no campaign evidence.',
    inputSchema: getPersonaPerformanceInputSchema,
    callback: ({ personaId }) => {
      const persona = control.state.personas.get(personaId as RecordId);
      if (!persona) return failure('UNKNOWN_PERSONA', 'Persona does not exist in this run.');
      const records = control.campaignRecords.filter((row) => row.personaId === persona.id);
      if (records.length === 0) return failure('NO_CAMPAIGN_EVIDENCE', 'This persona has no observed record in the selected campaign.');
      return success(control, { persona: personaSummary(persona), performance: records.map(observedRecord) });
    },
  });

  const searchCatalog = tool({
    name: recommendationToolNames.searchCatalog,
    description: 'Search read-only product names, descriptions, categories, and attributes; returns at most ten concise matches.',
    inputSchema: searchCatalogInputSchema,
    callback: ({ query, limit }) => {
      const needle = query.toLocaleLowerCase('en-US');
      const matches = [...control.state.products.values()].filter((product) => [
        product.name, product.description, product.category, ...Object.values(product.attributes),
      ].some((value) => value.toLocaleLowerCase('en-US').includes(needle))).slice(0, limit);
      return success(control, { matches: matches.map(productSummary), count: matches.length });
    },
  });

  const getProductDetails = tool({
    name: recommendationToolNames.getProductDetails,
    description: 'Read complete details for one catalog product, including attributes; returns an actionable error for an unknown product.',
    inputSchema: getProductDetailsInputSchema,
    callback: ({ productId }) => {
      const product = control.state.products.get(productId as RecordId);
      return product ? success(control, { product }) : failure('UNKNOWN_PRODUCT', 'Product does not exist in this run.');
    },
  });

  const listUntestedCombinations = tool({
    name: recommendationToolNames.listUntestedCombinations,
    description: 'List bounded persona-product pairs in the run catalog with no performance record in the selected campaign; returns an empty list when all pairs were tested.',
    inputSchema: listUntestedCombinationsInputSchema,
    callback: ({ limit }) => {
      const observed = new Set(control.campaignRecords.map((row) => `${row.personaId}:${row.productId}`));
      const combinations: Array<{ persona: ReturnType<typeof personaSummary>; product: ReturnType<typeof productSummary> }> = [];
      outer: for (const persona of control.state.personas.values()) {
        for (const product of control.state.products.values()) {
          if (!persona.productIds.includes(product.id)) continue;
          if (!observed.has(`${persona.id}:${product.id}`)) {
            combinations.push({ persona: personaSummary(persona), product: productSummary(product) });
            if (combinations.length >= limit) break outer;
          }
        }
      }
      return success(control, { combinations, count: combinations.length });
    },
  });

  const comparePerformance = tool({
    name: recommendationToolNames.comparePerformance,
    description: 'Compare observed campaign totals grouped by product or persona. CTR is recomputed from aggregate clicks and impressions; never implies causal effects.',
    inputSchema: comparePerformanceInputSchema,
    callback: ({ groupBy }) => {
      const groups = new Map<string, CampaignPerformanceRecord[]>();
      for (const row of control.campaignRecords) {
        const id = groupBy === 'product' ? row.productId : row.personaId;
        groups.set(id, [...(groups.get(id) ?? []), row]);
      }
      const comparisons = [...groups.entries()].map(([id, records]) => {
        const impressions = records.reduce((total, row) => total + row.impressions, 0);
        const clicks = records.reduce((total, row) => total + row.clicks, 0);
        return { id, records: records.length, impressions, clicks, ctr: impressions === 0 ? 0 : clicks / impressions };
      });
      return success(control, { groupBy, comparisons });
    },
  });

  const getMockMarketContext = tool({
    name: recommendationToolNames.getMockMarketContext,
    description: 'Return deterministic fictional market context for the campaign end date and an audience country. This is contextual fiction, not historical measurement or external market data.',
    inputSchema: getMockMarketContextInputSchema,
    callback: ({ country }) => control.campaignRecords.length === 0
      ? failure('NO_CAMPAIGN_EVIDENCE', 'No campaign has been initialized for this recommendation run.')
      : success(control, { marketContext: createMockMarketContext(campaignEndDate(control.campaignRecords), country) }),
  });

  return { getCampaignOverview, getPersonaPerformance, searchCatalog, getProductDetails, listUntestedCombinations, comparePerformance, getMockMarketContext };
}