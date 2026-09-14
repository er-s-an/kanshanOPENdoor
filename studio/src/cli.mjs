#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { StudioServices } from './services.mjs';
import { failure, StudioError } from './util.mjs';

const services = new StudioServices();

function parseArgs(argv) {
  const positionals = []; const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const stripped = token.slice(2); const equal = stripped.indexOf('=');
    if (equal >= 0) options[stripped.slice(0, equal)] = stripped.slice(equal + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) options[stripped] = argv[++i];
    else options[stripped] = true;
  }
  return { positionals, options };
}

async function jsonFile(file, label) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new StudioError('BAD_INPUT', `cannot read ${label || file}: ${error.message}`); } }
async function main(argv) {
  const { positionals, options } = parseArgs(argv); const [group, command] = positionals;
  if (group === 'capabilities') return services.capabilities();
  if (group === 'project' && command === 'create') return services.createProject({ sourceText: await readFile(String(options.source), 'utf8'), metadata: await jsonFile(options.metadata, 'metadata'), idempotencyKey: options['idempotency-key'] });
  if (group === 'revision' && command === 'import') return services.importRevision({ projectId: options.project, baseRevisionId: options['base-revision'], analysis: await jsonFile(options.analysis, 'analysis'), blueprint: await jsonFile(options.blueprint, 'blueprint'), idempotencyKey: options['idempotency-key'] });
  if (group === 'generate') return services.generate({ projectId: options.project, revisionId: options.revision || options['revision-id'], mode: options.mode, provider: options.provider, budget: { maxCalls: options['max-calls'] === undefined ? undefined : Number(options['max-calls']), maxRepairs: options['max-repairs'] === undefined ? undefined : Number(options['max-repairs']) }});
  if (group === 'build') return services.build({ projectId: options.project, revisionId: options.revision });
  if (group === 'validate') return services.validate({ projectId: options.project, revisionId: options.revision, level: options.level || 'static' });
  if (group === 'preview') return services.preview({ projectId: options.project, revisionId: options.revision, baseUrl: options.url || null });
  if (group === 'review' && command === 'record') return services.recordReview({ projectId: options.project, revisionId: options.revision, scope: options.scope, decision: options.decision, note: options.note, idempotencyKey: options['idempotency-key'] });
  if (group === 'export') return services.exportRevision({ projectId: options.project, revisionId: options.revision, audience: options.audience || 'private', out: options.out });
  if (group === 'job' && command === 'status') return services.getJob(options.job);
  if (group === 'job' && command === 'cancel') return services.cancelJob(options.job);
  throw new StudioError('BAD_INPUT', 'unknown command; run capabilities or consult the CLI contract');
}

try {
  const output = await main(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(failure(error))}\n`);
  const code = error?.code === 'CANCELLED' ? 130 : ['BAD_INPUT', 'CONTENT_INVALID'].includes(error?.code) ? 2 : ['CAPABILITY_GAP', 'BUDGET_EXCEEDED', 'PROVIDER_UNAVAILABLE'].includes(error?.code) ? 3 : error?.code === 'REVISION_CONFLICT' ? 4 : 5;
  process.exitCode = code;
}

export { parseArgs, main };
