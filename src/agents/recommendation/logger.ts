import {
  createConsoleRunTraceLogger,
  noopRunTraceLogger,
} from '../../shared/logger.js';
import type { RunTraceLogEvent, RunTraceLogger } from '../../shared/logger.js';

export const recommendationToolNames = {
  getCampaignOverview: 'getCampaignOverview',
  getPersonaPerformance: 'getPersonaPerformance',
  searchCatalog: 'searchCatalog',
  getProductDetails: 'getProductDetails',
  listUntestedCombinations: 'listUntestedCombinations',
  comparePerformance: 'comparePerformance',
  getMockMarketContext: 'getMockMarketContext',
} as const;

const registeredToolNames = new Set<string>(Object.values(recommendationToolNames));

export type RecommendationLogEvent = RunTraceLogEvent;

export interface RecommendationLogger extends RunTraceLogger {}

export function isRecommendationToolName(toolName: string): boolean {
  return registeredToolNames.has(toolName);
}

export const consoleRecommendationLogger: RecommendationLogger = createConsoleRunTraceLogger(registeredToolNames);

export const noopRecommendationLogger: RecommendationLogger = noopRunTraceLogger;