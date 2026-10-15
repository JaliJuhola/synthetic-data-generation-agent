import dotenv from 'dotenv';
import { GenerationError } from '../contracts.js';

export interface AzureConfig {
  resourceName: string;
  apiKey: string;
  deployment: string;
}

const requiredEnvironmentVariables = [
  'AZURE_OPENAI_RESOURCE_NAME',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT',
] as const;

const placeholderPattern = /^(?:<.*>|your(?:[-_ ]|$)|replace(?:[-_ ]|$)|placeholder|change[-_ ]?me|example(?:[-_ ]|$)|x{3,}|\.{3,})/i;

export function loadAzureConfig(environment?: NodeJS.ProcessEnv): AzureConfig {
  if (!environment) {
    dotenv.config({ quiet: true });
  }

  const values = environment ?? process.env;
  const missing = requiredEnvironmentVariables.filter((key) => !values[key]?.trim());
  const placeholders = requiredEnvironmentVariables.filter((key) => {
    const value = values[key]?.trim();
    return value !== undefined && placeholderPattern.test(value);
  });
  const resourceName = values.AZURE_OPENAI_RESOURCE_NAME?.trim();
  const invalid = resourceName && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(resourceName)
    ? ['AZURE_OPENAI_RESOURCE_NAME']
    : [];

  if (missing.length || placeholders.length || invalid.length) {
    const problems = [
      missing.length ? `missing: ${missing.join(', ')}` : undefined,
      placeholders.length ? `placeholder values: ${placeholders.join(', ')}` : undefined,
      invalid.length ? `invalid values: ${invalid.join(', ')}` : undefined,
    ].filter((problem): problem is string => problem !== undefined);

    throw new GenerationError(
      'CONFIGURATION_INVALID',
      `Azure OpenAI configuration is invalid (${problems.join('; ')}). Set these values in .env or the process environment.`,
    );
  }

  return {
    resourceName: resourceName!,
    apiKey: values.AZURE_OPENAI_API_KEY!.trim(),
    deployment: values.AZURE_OPENAI_DEPLOYMENT!.trim(),
  };
}