import type { CampaignPerformanceRecord } from '../../shared/contracts.js';

function dateCount(startDate: string, endDate: string): number {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function datesInRange(startDate: string, count: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function seededWeights(dates: readonly string[], seed: number, key: string): number[] {
  let hash = seed >>> 0;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return dates.map((date) => {
    hash = (Math.imul(hash, 1_664_525) + 1_013_904_223) >>> 0;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekdayWeight = weekday === 0 || weekday === 6 ? 12 : 9;
    return weekdayWeight * 100 + (hash % 101);
  });
}

function allocateIntegerTotal(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const integerWeights = weights.map((weight) => BigInt(weight));
  const weightTotal = integerWeights.reduce((sum, weight) => sum + weight, 0n);
  const integerTotal = BigInt(total);
  const allocations = integerWeights.map((weight) => Number((integerTotal * weight) / weightTotal));
  let remainder = total - allocations.reduce((sum, value) => sum + value, 0);
  const priority = integerWeights.map((weight, index) => ({
    index,
    remainder: (integerTotal * weight) % weightTotal,
  })).sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) allocations[priority[index % priority.length].index] += 1;
  return allocations;
}

function allocateCappedIntegerTotal(total: number, weights: readonly number[], capacities: readonly number[]): number[] {
  if (weights.length !== capacities.length) throw new RangeError('Allocation weights and capacities must have equal lengths.');
  if (capacities.some((capacity) => !Number.isSafeInteger(capacity) || capacity < 0)
    || capacities.reduce((sum, capacity) => sum + capacity, 0) < total) {
    throw new RangeError('Daily click total exceeds the available impression capacity.');
  }

  const allocations = Array<number>(capacities.length).fill(0);
  let remaining = total;
  let available = capacities.map((capacity, index) => index).filter((index) => capacities[index] > 0);
  while (remaining > 0) {
    if (available.length === 0) throw new RangeError('Daily click total exceeds the available impression capacity.');
    const proposed = allocateIntegerTotal(remaining, available.map((index) => weights[index]));
    const capped = available.filter((index, position) => proposed[position] > capacities[index] - allocations[index]);
    if (capped.length === 0) {
      available.forEach((index, position) => { allocations[index] += proposed[position]; });
      break;
    }

    for (const index of capped) {
      const capacity = capacities[index] - allocations[index];
      allocations[index] += capacity;
      remaining -= capacity;
    }
    const cappedIndices = new Set(capped);
    available = available.filter((index) => !cappedIndices.has(index));
  }
  return allocations;
}

export function expandDailyMeasurements(
  startDate: string,
  endDate: string,
  impressions: number,
  clicks: number,
  seed: number,
  relationshipKey: string,
): CampaignPerformanceRecord['dailyMeasurements'] {
  if (!Number.isSafeInteger(impressions) || impressions < 0 || !Number.isSafeInteger(clicks) || clicks < 0 || clicks > impressions) {
    throw new RangeError('Daily expansion requires nonnegative safe integer totals with clicks no greater than impressions.');
  }
  const count = dateCount(startDate, endDate);
  if (!Number.isInteger(count) || count <= 0) throw new RangeError('Campaign date range is invalid.');
  const dates = datesInRange(startDate, count);
  const weights = seededWeights(dates, seed, relationshipKey);
  const dailyImpressions = allocateIntegerTotal(impressions, weights);
  const dailyClicks = allocateCappedIntegerTotal(clicks, weights, dailyImpressions);
  return dates.map((date, index) => ({ date, impressions: dailyImpressions[index], clicks: dailyClicks[index] }));
}
