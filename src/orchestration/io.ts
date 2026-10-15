import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GenerationError } from '../shared/contracts.js';
import type { GenerationState, RecordId, RunId, TargetingValues } from '../shared/contracts.js';
import { MAX_DATASET_BYTES, MAX_TARGETING_FILE_BYTES } from './constants.js';

function normalizeTargeting(contents: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    const value = line.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

export async function loadTargetingValues(dataDirectory: string): Promise<TargetingValues> {
  const files = [
    { name: 'interests.txt', key: 'interests' as const },
    { name: 'page_context.txt', key: 'contextualTargeting' as const },
  ];
  const values = await Promise.all(files.map(async ({ name, key }) => {
    const path = join(dataDirectory, name);
    try {
      const fileInfo = await stat(path);
      if (fileInfo.size > MAX_TARGETING_FILE_BYTES) {
        throw new GenerationError('LIMIT_EXCEEDED', `Targeting file data/${name} exceeds the ${MAX_TARGETING_FILE_BYTES}-byte limit.`);
      }
      const contents = await readFile(path, 'utf8');
      const normalized = normalizeTargeting(contents);
      if (normalized.length === 0) throw new GenerationError('TARGETING_FILE_MISSING', `Required targeting file data/${name} has no normalized values.`);
      return [key, normalized] as const;
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      const description = code === 'ENOENT' ? 'is missing' : 'could not be read';
      throw new GenerationError('TARGETING_FILE_MISSING', `Required targeting file data/${name} ${description}.`);
    }
  }));
  return { interests: values[0][1], contextualTargeting: values[1][1] };
}

export function createGenerationState(runId: RunId, targeting: TargetingValues, startedAt: Date): GenerationState {
  return {
    runId,
    startedAt,
    targeting,
    references: new Map(),
    products: new Map(),
    personas: new Map(),
    campaignPerformance: new Map(),
  };
}

export function referenceFor(state: GenerationState, id: RecordId, prefix: 'product' | 'persona'): string {
  for (const [reference, recordId] of state.references) if (recordId === id) return reference;
  throw new GenerationError('VALIDATION_FAILED', `Accepted ${prefix} record has no short reference.`);
}

export async function writeJson<T>(directory: string, filename: string, value: T, runId: string): Promise<string> {
  const path = join(directory, filename);
  const temporaryPath = `${path}.${runId}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_DATASET_BYTES) {
      throw new GenerationError('LIMIT_EXCEEDED', `${filename} exceeds the ${MAX_DATASET_BYTES}-byte output limit.`);
    }
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
    return path;
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError('OUTPUT_FAILED', `Could not write ${filename} in ${directory}.`);
  }
}

export async function writeEvaluationReport<T>(directory: string, runId: string, report: T): Promise<string> {
  return writeJson(directory, 'evaluation-report.json', report, runId);
}