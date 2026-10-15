import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunId } from './contracts.js';
import {
  createConsoleRunTraceLogger,
  noopRunTraceLogger,
  type RunTraceLogEvent,
} from './logger.js';

const event: RunTraceLogEvent = {
  runId: '00000000-0000-4000-8000-000000000001' as RunId,
  event: 'tool.completed',
  agentName: 'catalog-persona',
  toolName: 'createProduct',
  elapsedMs: 175,
  durationMs: 12,
  outcome: 'success',
  usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared run trace logger', () => {
  it('formats safe trace fields and omits timestamps and payload fields', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {});
    const eventWithExtras = {
      ...event,
      occurredAt: '2026-01-01T00:00:00.000Z',
      prompt: 'secret prompt',
      arguments: { secret: 'input' },
      result: { secret: 'output' },
      usage: { ...event.usage, providerBody: 'secret response' },
    } as RunTraceLogEvent;

    createConsoleRunTraceLogger(['createProduct']).log(eventWithExtras);

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toBe('[00000000 | 0.175s] catalog-persona -> createProduct (tool) completed (0.012s) -> Success | tokens 4 in, 3 out, 7 total');
    expect(String(write.mock.calls[0][0])).not.toContain('secret');
  });

  it('preserves registered tool names and omits unknown names', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createConsoleRunTraceLogger(new Set(['createProduct']));

    logger.log(event);
    logger.log({ ...event, toolName: 'unregisteredTool' });

    expect(write.mock.calls[0][0]).toContain('createProduct (tool) completed');
    expect(write.mock.calls[1][0]).not.toContain('unregisteredTool');
  });

  it('prints safe error codes for rejected tool results', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createConsoleRunTraceLogger(['savePersonaCandidate']);

    logger.log({
      ...event,
      toolName: 'savePersonaCandidate',
      errorCode: 'PRODUCT_REFERENCE_COUNT',
      outcome: 'error',
    });

    expect(write.mock.calls[0][0]).toContain('savePersonaCandidate (tool) rejected (0.012s) [PRODUCT_REFERENCE_COUNT]');
  });

  it('omits tool names when no allowlist is provided', () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {});

    createConsoleRunTraceLogger().log(event);

    expect(write.mock.calls[0][0]).not.toContain('createProduct');
  });

  it('supports a no-op logger', () => {
    expect(() => noopRunTraceLogger.log(event)).not.toThrow();
  });

  it('keeps console writer errors nonfatal', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('writer unavailable');
    });

    expect(() => createConsoleRunTraceLogger(['createProduct']).log(event)).not.toThrow();
  });
});