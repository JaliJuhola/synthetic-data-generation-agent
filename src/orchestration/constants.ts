import type { CtrBand, PerformanceTier } from '../agents/performance/index.js';

export const MAX_RECORDS_PER_TYPE = 100;
export const MAX_CAMPAIGN_DAYS = 366;
export const MAX_TARGETING_FILE_BYTES = 256_000;
export const MAX_DATASET_BYTES = 5_000_000;

export const DEFAULT_CTR_BANDS: Record<PerformanceTier, CtrBand> = {
  low: { min: 0.001, max: 0.01 },
  medium: { min: 0.011, max: 0.03 },
  high: { min: 0.031, max: 0.1 },
};