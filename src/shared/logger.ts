import type { RunTraceEvent } from './contracts.js';

export type RunTraceLogEvent = Pick<
  RunTraceEvent,
  'runId' | 'event' | 'agentName' | 'toolName' | 'errorCode' | 'elapsedMs' | 'durationMs' | 'outcome' | 'usage'
>;

export interface RunTraceLogger {
  log(event: RunTraceLogEvent): void;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(3)}s`;
}

function safeLabel(value: string): string {
  return value.replace(/[^\w.-]/gu, '?');
}

function formatRunTraceEvent(event: RunTraceLogEvent, allowedToolNames: ReadonlySet<string>): string {
  const [category, action] = event.event.split('.');
  const toolName = event.toolName && allowedToolNames.has(event.toolName)
    ? safeLabel(event.toolName)
    : undefined;
  const subject = category === 'tool'
    ? `${toolName ? `${toolName} ` : ''}(tool)`
    : category;
  const actionLabel = event.errorCode === undefined ? action : 'rejected';
  const duration = event.durationMs === undefined ? '' : ` (${seconds(event.durationMs)})`;
  const outcome = event.errorCode !== undefined
    ? ` [${safeLabel(event.errorCode)}]`
    : event.outcome === undefined ? '' : ` -> ${event.outcome === 'success' ? 'Success' : 'Error'}`;
  const usage = event.usage === undefined
    ? ''
    : ` | tokens ${event.usage.inputTokens} in, ${event.usage.outputTokens} out, ${event.usage.totalTokens} total`;
  const runId = safeLabel(event.runId).slice(0, 8);
  const agentName = event.agentName === undefined ? 'agent' : safeLabel(event.agentName);
  const elapsed = event.elapsedMs === undefined ? '?' : seconds(event.elapsedMs);

  return `[${runId} | ${elapsed}] ${agentName} -> ${subject} ${actionLabel}${duration}${outcome}${usage}`;
}

export function createConsoleRunTraceLogger(
  registeredToolNames?: Iterable<string>,
): RunTraceLogger {
  const allowedToolNames = new Set(registeredToolNames);

  return {
    log(event) {
      try {
        console.log(formatRunTraceEvent(event, allowedToolNames));
      } catch {
        // Trace logging must not interrupt the run.
      }
    },
  };
}

export const noopRunTraceLogger: RunTraceLogger = {
  log() {},
};