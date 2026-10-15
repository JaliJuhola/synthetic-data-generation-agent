import { z } from 'zod';
import { CLI_CONFIGURATION } from '../../configuration.js';
import type { CliConfiguration } from '../../configuration.js';
import { GenerationError } from '../shared/contracts.js';
import { MAX_PRODUCTS_PER_PERSONA, PRODUCTS_PER_GROUP } from '../agents/catalog-persona/constants.js';
import { defaultGenerationRequest } from '../orchestration/index.js';
import type { GenerationRequest } from '../orchestration/index.js';

export type CommandOptions = { values: Map<string, string>; positional: string[] };

export function parseOptions(args: string[], allowed: readonly string[]): CommandOptions {
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const name = item.slice(2);
    if (!allowed.includes(name)) throw new GenerationError('VALIDATION_FAILED', `Unknown option --${name}.`);
    if (values.has(name)) throw new GenerationError('VALIDATION_FAILED', `Option --${name} may only be supplied once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new GenerationError('VALIDATION_FAILED', `Option --${name} requires a value.`);
    values.set(name, value);
    index += 1;
  }
  return { values, positional };
}

function integerOption(values: Map<string, string>, name: string, fallback: number): number {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/u.test(raw)) throw new GenerationError('VALIDATION_FAILED', `--${name} must be a nonnegative integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new GenerationError('VALIDATION_FAILED', `--${name} must be a safe integer.`);
  return value;
}

function generationRequest(values: Map<string, string>, configuration: CliConfiguration): GenerationRequest {
  const defaults = defaultGenerationRequest('US');
  const groupsOf10 = integerOption(values, 'groups-of-10', configuration.generation.groupsOf10);
  if (groupsOf10 < 1) throw new GenerationError('VALIDATION_FAILED', '--groups-of-10 must be at least 1.');
  const productsPerPersona = integerOption(values, 'products-per-persona', configuration.generation.productsPerPersona);
  if (productsPerPersona < 1 || productsPerPersona > MAX_PRODUCTS_PER_PERSONA) {
    throw new GenerationError('VALIDATION_FAILED', `--products-per-persona must be from 1 to ${MAX_PRODUCTS_PER_PERSONA}.`);
  }
  const startDate = values.get('start-date') ?? defaults.startDate;
  if (!z.iso.date().safeParse(startDate).success) {
    throw new GenerationError('VALIDATION_FAILED', '--start-date must be a valid ISO date in YYYY-MM-DD format.');
  }
  const defaultEndDate = values.has('start-date')
    ? defaultGenerationRequest('US', new Date(`${startDate}T00:00:00.000Z`)).endDate
    : defaults.endDate;
  const endDate = values.get('end-date') ?? defaultEndDate;
  return {
    ...defaults,
    products: groupsOf10 * PRODUCTS_PER_GROUP,
    groupsOf10,
    personas: integerOption(values, 'personas', configuration.generation.personas),
    productsPerPersona,
    startDate,
    endDate,
    seed: integerOption(values, 'seed', configuration.generation.seed),
    scenario: values.get('scenario') ?? configuration.generation.scenario,
  };
}

export function parseGenerateArguments(
  args: string[],
  configuration: CliConfiguration = CLI_CONFIGURATION,
): { request: GenerationRequest; values: Map<string, string> } {
  const { values, positional } = parseOptions(args, configuration.queryParameters.generate);
  if (positional.length) throw new GenerationError('VALIDATION_FAILED', 'generate does not accept positional arguments.');
  return { request: generationRequest(values, configuration), values };
}