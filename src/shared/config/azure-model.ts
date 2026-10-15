import { createAzure } from '@ai-sdk/azure';
import type { AzureOpenAIProviderSettings } from '@ai-sdk/azure';
import { VercelModel } from '@strands-agents/sdk/models/vercel';
import type { AzureConfig } from './azure.js';

export const AZURE_REQUEST_TIMEOUT_MS = 90_000;
export const AZURE_REASONING_EFFORT = 'low';

type FetchFunction = NonNullable<AzureOpenAIProviderSettings['fetch']>;

export function createAzureRequestFetch(
  timeoutMs: number,
  fetchImplementation: FetchFunction = globalThis.fetch,
): FetchFunction {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetchImplementation(input, { ...init, signal });
  };
}

export function createAzureModel(config: AzureConfig): VercelModel {
  const azure = createAzure({
    resourceName: config.resourceName,
    apiKey: config.apiKey,
    fetch: createAzureRequestFetch(AZURE_REQUEST_TIMEOUT_MS),
  });

  return new VercelModel({
    provider: azure(config.deployment),
    providerOptions: { azure: { reasoningEffort: AZURE_REASONING_EFFORT } },
  });
}