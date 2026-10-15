import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGenerateArguments } from './cli/arguments.js';
import { CLI_CONFIGURATION } from '../configuration.js';
import { createMockAgentModels, createMockRecommendationModel } from './cli/offline-models.js';
import { runGeneration, runRecommendationFile, validateGenerationRequest, defaultGenerationRequest } from './orchestration/index.js';
import type { GenerationRequest } from './orchestration/index.js';
import type { RunId } from './shared/contracts.js';
import { CATALOG_PERSONA_TOOL_NAMES } from './agents/catalog-persona/tools.js';
import { PERFORMANCE_TOOL_NAMES } from './agents/performance/tools.js';
import { createConsoleRunTraceLogger, noopRunTraceLogger } from './shared/logger.js';

const temporaryDirectories: string[] = [];

async function makeDirectories() {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-generator-'));
  temporaryDirectories.push(root);
  const data = join(root, 'data');
  const output = join(root, 'output');
  await mkdir(data);
  await writeFile(join(data, 'interests.txt'), ' Trail Running \nTrail Running\nCamping\n');
  await writeFile(join(data, 'page_context.txt'), ' Trail Shoe Reviews \nDay Pack Guides\n');
  return { root, data, output };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('local orchestration', () => {
  it('logs safe generation lifecycle events by default while preserving report aggregation', async () => {
    const directories = await makeDirectories();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scenario = 'SENSITIVE_SCENARIO_SENTINEL';
    const request = { ...defaultGenerationRequest('US'), products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01', scenario };
    const generated = await runGeneration({
      request,
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      createModels: (state) => createMockAgentModels(state),
    });

    const logLines = consoleLog.mock.calls.map(([line]) => String(line));
    expect(logLines[0]).toMatch(/\[[0-9a-f?]{8} \| \d+\.\d{3}s\] catalog-persona -> run started/u);
    expect(logLines.some((line) => line.includes('catalog-persona -> model started'))).toBe(true);
    expect(logLines.some((line) => line.includes('saveProductBatch (tool) started'))).toBe(true);
    expect(logLines.some((line) => line.includes('validatePerformance (tool) completed') && line.includes('-> Success'))).toBe(true);
    expect(logLines.some((line) => line.includes('performance -> run completed') && line.includes('-> Success'))).toBe(true);
    expect(logLines.some((line) => line.includes('tokens 5 in, 3 out, 8 total'))).toBe(true);
    expect(logLines.every((line) => !line.includes(scenario) && !line.includes('Fictional Alpine Day Pack'))).toBe(true);
    expect(generated.report.execution).toMatchObject({ modelCalls: 12, toolCalls: 9 });
    expect(generated.report.execution.tokenUsage).toEqual({ inputTokens: 60, outputTokens: 36, totalTokens: 96 });
  });

  it('supports custom and no-op loggers and isolates logger failures from report aggregation', async () => {
    const directories = await makeDirectories();
    const received: Array<Record<string, unknown>> = [];
    const customRun = await runGeneration({
      request: { ...defaultGenerationRequest('US'), products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01' },
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      logger: { log: (event) => { received.push(event); throw new Error('logger failed'); } },
      createModels: (state) => createMockAgentModels(state),
    });
    expect(received.some((event) => event.event === 'run.started')).toBe(true);
    expect(received.some((event) => event.toolName === 'saveProductBatch')).toBe(true);
    expect(received.every((event) => Object.keys(event).every((key) => [
      'runId', 'event', 'agentName', 'toolName', 'elapsedMs', 'durationMs', 'outcome', 'usage',
    ].includes(key)))).toBe(true);
    expect(customRun.report.execution).toMatchObject({ modelCalls: 12, toolCalls: 9 });

    const noopRun = await runGeneration({
      request: { ...defaultGenerationRequest('US'), products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01' },
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      logger: noopRunTraceLogger,
      createModels: (state) => createMockAgentModels(state),
    });
    expect(noopRun.report.status).toBe('completed');
  });

  it('omits unregistered tool names from console trace records', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const registeredToolNames = [
      ...Object.values(CATALOG_PERSONA_TOOL_NAMES),
      ...Object.values(PERFORMANCE_TOOL_NAMES),
    ];
    const logger = createConsoleRunTraceLogger(registeredToolNames);
    logger.log({ runId: 'run-1' as RunId, event: 'tool.started', toolName: 'unknownTool' });
    logger.log({ runId: 'run-1' as RunId, event: 'tool.started', toolName: 'saveProductBatch' });

    expect(String(consoleLog.mock.calls[0]?.[0])).not.toContain('unknownTool');
    expect(String(consoleLog.mock.calls[1]?.[0])).toContain('saveProductBatch (tool) started');
  });

  it('uses the fixed default country for generated personas', async () => {
    const directories = await makeDirectories();
    const request = { ...defaultGenerationRequest('US'), products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01' };
    const generated = await runGeneration({
      request,
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      createModels: (state) => createMockAgentModels(state),
    });

    expect(generated.report.request.country).toBe('US');
    expect(generated.dataset?.personas.map((persona) => persona.country)).toEqual(['US']);
  });

  it('rejects removed country and days query parameters', () => {
    expect(() => parseGenerateArguments(['--country', 'CA'])).toThrow('Unknown option --country.');
    expect(() => parseGenerateArguments(['--days', '14'])).toThrow('Unknown option --days.');
    expect(() => parseGenerateArguments(['--products', '10'])).toThrow('Unknown option --products.');
  });

  it('maps the configured groups-of-ten option to the requested product count', () => {
    const { request } = parseGenerateArguments(['--groups-of-10', '3', '--products-per-persona', '7']);
    expect(request).toMatchObject({ groupsOf10: 3, products: 30, productsPerPersona: 7 });
    expect(() => parseGenerateArguments(['--groups-of-10', '0'])).toThrow('--groups-of-10 must be at least 1.');
    expect(() => parseGenerateArguments(['--products-per-persona', '0']))
      .toThrow('--products-per-persona must be from 1 to 10.');
  });

  it('rejects malformed CLI start dates before deriving the default end date', () => {
    expect(() => parseGenerateArguments(['--start-date', 'not-a-date']))
      .toThrow('--start-date must be a valid ISO date in YYYY-MM-DD format.');

    const { request } = parseGenerateArguments(['--start-date', '2026-05-01']);
    expect(request).toMatchObject({
      startDate: '2026-05-01',
      endDate: '2026-05-14',
      products: CLI_CONFIGURATION.generation.groupsOf10 * 10,
      groupsOf10: CLI_CONFIGURATION.generation.groupsOf10,
      personas: CLI_CONFIGURATION.generation.personas,
      productsPerPersona: CLI_CONFIGURATION.generation.productsPerPersona,
      seed: CLI_CONFIGURATION.generation.seed,
      scenario: CLI_CONFIGURATION.generation.scenario,
    });
  });

  it('runs ordered mock generation, validates and persists normalized data and reports', async () => {
    const directories = await makeDirectories();
    const base = defaultGenerationRequest('CA', new Date('2026-05-01T12:00:00.000Z'));
    const request = { ...base, products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01' };
    const generated = await runGeneration({
      request,
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      createModels: (state) => createMockAgentModels(state),
    });
    expect(generated.report).toMatchObject({
      status: 'completed',
      counts: { products: 1, personas: 1, campaignPerformance: 1 },
      validation: { valid: true, issues: [] },
      execution: { phasesCompleted: ['catalog-persona', 'performance'], modelCalls: 12, toolCalls: 9, repairAttempts: 0 },
    });
    expect(generated.dataset?.targeting).toEqual({
      interests: ['Trail Running', 'Camping'],
      contextualTargeting: ['Trail Shoe Reviews', 'Day Pack Guides'],
    });
    expect(generated.dataset?.personas[0]).toMatchObject({
      interests: ['Trail Running', 'Camping'],
      contextualTargeting: ['Trail Shoe Reviews'],
    });
    expect(generated.report.request.country).toBe('CA');
    expect(generated.dataset?.personas.every((persona) => persona.country === 'CA')).toBe(true);
    expect(await readFile(generated.datasetPath!, 'utf8')).toContain('synthetic');
    expect(JSON.parse(await readFile(generated.productsPath!, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(await readFile(generated.personaPath!, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(await readFile(generated.performancePath!, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(await readFile(generated.reportPath, 'utf8')).dataSemantics.performance).toBe('synthetic-historic-measurements');

    const sourceBeforeRecommendations = await readFile(generated.datasetPath!, 'utf8');
    const recommendation = await runRecommendationFile({
      inputPath: generated.datasetPath!,
      outputDirectory: directories.output,
      createModel: (state) => createMockRecommendationModel(state),
    });
    expect(recommendation.output.generationId).toBe(generated.dataset?.runId);
    expect(recommendation.output.provenance).toMatchObject({
      observedEvidence: 'synthetic-historic-measurements',
      marketContext: 'fictional-context-not-historical-measurement',
    });
    expect(recommendation.report).toMatchObject({ modelCalls: 8, toolCalls: 8, recommendationCount: 1 });
    expect(await readFile(generated.datasetPath!, 'utf8')).toBe(sourceBeforeRecommendations);
  });

  it('rejects a mixed-campaign recommendation dataset before creating the agent model', async () => {
    const directories = await makeDirectories();
    const request = { ...defaultGenerationRequest('US'), products: 1, personas: 1, startDate: '2026-05-01', endDate: '2026-05-01' };
    const generated = await runGeneration({
      request,
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      createModels: (state) => createMockAgentModels(state),
    });
    const firstRecord = generated.dataset!.campaignPerformance[0]!;
    const mixedDataset = {
      ...generated.dataset!,
      campaignPerformance: [
        firstRecord,
        {
          ...firstRecord,
          id: '00000000-0000-4000-8000-000000000001' as typeof firstRecord.id,
          campaignId: '00000000-0000-4000-8000-000000000002' as typeof firstRecord.campaignId,
        },
      ],
    };
    await writeFile(generated.datasetPath!, JSON.stringify(mixedDataset));

    let modelFactoryCalls = 0;
    await expect(runRecommendationFile({
      inputPath: generated.datasetPath!,
      outputDirectory: directories.output,
      createModel: () => {
        modelFactoryCalls += 1;
        throw new Error('Recommendation model must not be created for mixed campaigns.');
      },
    })).rejects.toThrow('contains 2 campaign IDs; recommendation import requires a single campaign.');
    expect(modelFactoryCalls).toBe(0);
  });

  it('writes a failed report without persisting an incomplete dataset when targeting is missing', async () => {
    const directories = await makeDirectories();
    await rm(join(directories.data, 'page_context.txt'));
    const request = { ...defaultGenerationRequest('US'), products: 1, personas: 1 };
    await expect(runGeneration({
      request,
      dataDirectory: directories.data,
      outputDirectory: directories.output,
      createModels: (state) => createMockAgentModels(state),
    }))
      .rejects.toThrow('Required targeting file data/page_context.txt is missing.');
    const report = JSON.parse(await readFile(join(directories.output, 'generation-report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'failed', counts: { products: 0, personas: 0, campaignPerformance: 0 }, failure: { code: 'TARGETING_FILE_MISSING' } });
  });

  it('rejects overlapping CTR bands and caps the full performance matrix', () => {
    const request = defaultGenerationRequest('US');
    expect(() => validateGenerationRequest({ ...request, ctrBands: { ...request.ctrBands, low: { min: 0.005, max: 0.02 } } })).toThrow(/non-overlapping/);
    expect(() => validateGenerationRequest({ ...request, products: 11, personas: 10 })).toThrow(/performance records/);
    expect(() => validateGenerationRequest({ ...request, country: 'NZ' } as unknown as GenerationRequest)).toThrow(/Country must be one of: US, CA, GB, AU/);
    expect(() => validateGenerationRequest({ ...request, country: undefined } as unknown as GenerationRequest)).toThrow(/Country must be one of: US, CA, GB, AU/);
  });
});