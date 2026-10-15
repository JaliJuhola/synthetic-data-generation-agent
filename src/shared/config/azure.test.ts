import { describe, expect, it } from 'vitest';
import { VercelModel } from '@strands-agents/sdk/models/vercel';
import { AZURE_REASONING_EFFORT, createAzureModel, createAzureRequestFetch } from './azure-model.js';
import { loadAzureConfig } from './azure.js';

describe('loadAzureConfig', () => {
  it('accepts a resource name, API key, and deployment name', () => {
    expect(loadAzureConfig({
      AZURE_OPENAI_RESOURCE_NAME: 'sample-resource',
      AZURE_OPENAI_API_KEY: 'opaque-secret-value',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-prod',
    })).toEqual({
      resourceName: 'sample-resource',
      apiKey: 'opaque-secret-value',
      deployment: 'gpt-4o-prod',
    });
  });

  it('reports missing and placeholder settings without echoing values', () => {
    let caught: unknown;
    try {
      loadAzureConfig({
        AZURE_OPENAI_RESOURCE_NAME: 'your-resource-name',
        AZURE_OPENAI_API_KEY: 'replace-with-sensitive-secret',
        AZURE_OPENAI_DEPLOYMENT: '',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('AZURE_OPENAI_DEPLOYMENT');
    expect((caught as Error).message).toContain('AZURE_OPENAI_RESOURCE_NAME');
    expect((caught as Error).message).not.toContain('replace-with-sensitive-secret');
  });

  it('rejects invalid resource names without including the value', () => {
    expect(() => loadAzureConfig({
      AZURE_OPENAI_RESOURCE_NAME: 'not a valid resource',
      AZURE_OPENAI_API_KEY: 'opaque-secret-value',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-prod',
    })).toThrow(/AZURE_OPENAI_RESOURCE_NAME/);
  });

  it('constructs the supported adapter without making a model request', () => {
    const config = loadAzureConfig({
      AZURE_OPENAI_RESOURCE_NAME: 'sample-resource',
      AZURE_OPENAI_API_KEY: 'opaque-secret-value',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-prod',
    });

    const model = createAzureModel(config);
    expect(model).toBeInstanceOf(VercelModel);
    expect(model.getConfig().providerOptions).toEqual({ azure: { reasoningEffort: AZURE_REASONING_EFFORT } });
  });
});

describe('Azure request timeout', () => {
  it('aborts a stalled fetch after the configured timeout', async () => {
    let fetchCalled = false;
    const fetchImplementation: typeof fetch = (_input, init) => {
      fetchCalled = true;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    };
    const fetchWithTimeout = createAzureRequestFetch(10, fetchImplementation);

    await expect(fetchWithTimeout('https://example.test')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchCalled).toBe(true);
  });

  it('preserves caller cancellation signals', async () => {
    let forwardedSignal: AbortSignal | null | undefined;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      forwardedSignal = init?.signal;
      return new Response('ok');
    };
    const controller = new AbortController();
    const fetchWithTimeout = createAzureRequestFetch(10_000, fetchImplementation);

    await fetchWithTimeout('https://example.test', { signal: controller.signal });
    expect(forwardedSignal).toBeDefined();
    expect(forwardedSignal).not.toBe(controller.signal);
    controller.abort();
    expect(forwardedSignal?.aborted).toBe(true);
  });
});