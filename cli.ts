import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenerationError } from './src/shared/contracts.js';
import type { CliConfiguration } from './configuration.js';
import { CLI_CONFIGURATION } from './configuration.js';
import { parseGenerateArguments, parseOptions } from './src/cli/arguments.js';
import { generate, localEvaluation, printHelp, recommend } from './src/cli/commands.js';

function safeError(error: unknown): string {
  return error instanceof GenerationError ? error.message : 'Unexpected local failure; details omitted.';
}

async function runCli(configuration: CliConfiguration): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    printHelp();
    return;
  }
  if (!['generate', 'recommend', 'eval', 'smoke'].includes(command)) {
    throw new GenerationError('VALIDATION_FAILED', `Unknown command ${command}. Run with --help for usage.`);
  }
  if (command === 'generate') {
    const { request, values } = parseGenerateArguments(args, configuration);
    await generate(request, values, configuration);
    return;
  }
  const allowed = command === 'recommend' ? configuration.queryParameters.recommend : configuration.queryParameters.evaluation;
  const { values, positional } = parseOptions(args, allowed);
  if (command === 'recommend') {
    await recommend(positional, values);
  } else {
    if (positional.length) throw new GenerationError('VALIDATION_FAILED', `${command} does not accept positional arguments.`);
    await localEvaluation(command as 'smoke' | 'eval', values, configuration);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli(CLI_CONFIGURATION).catch((error: unknown) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}