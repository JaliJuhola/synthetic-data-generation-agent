import type { GenerationState } from '../../../shared/contracts.js';
import type { SupportedCountry } from '../constants.js';

export interface CatalogPersonaRequest {
  products: number;
  groupsOf10?: number;
  productsPerPersona?: number;
  personas: number;
  country: SupportedCountry;
  scenario?: string;
}

export interface CatalogPersonaResult {
  runId: GenerationState['runId'];
  products: number;
  personas: number;
  repairAttempts: number;
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
}