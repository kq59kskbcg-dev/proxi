// Runs a prompt version over its eval dataset in Langfuse. Used by `npm run eval` and
// `npm run promote`, so a prompt only reaches production after it passes.

import { TITLE_MODEL } from '../lib/title.js';

// Prompts that have an eval. Each dataset item has the prompt's variables as its input and
// the exact expected reply as its expected output.
export const DATASETS = {
  'classifiers/language': 'evals/classifier-language',
  'classifiers/escalation': 'evals/classifier-escalation',
};

// Same model and settings as the app uses for these classifiers.
export async function evalPrompt(langfuse, client, name, version) {
  const datasetName = DATASETS[name];
  if (!datasetName) throw new Error(`No eval dataset for "${name}"`);
  const prompt = await langfuse.getPrompt(name, version, { cacheTtlSeconds: 0 });
  const { data } = await langfuse.api.datasetItemsList({ datasetName, limit: 100 });
  const items = data.filter((item) => item.status !== 'ARCHIVED');
  const failures = [];
  for (const item of items) {
    const res = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 8,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt.compile(item.input) }],
    }, { timeout: 15_000, maxRetries: 1 });
    const got = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toLowerCase();
    const expected = String(item.expectedOutput).toLowerCase();
    if (got !== expected) failures.push({ input: item.input, expected, got });
  }
  return { name, version, datasetName, total: items.length, passed: items.length - failures.length, failures, ok: items.length > 0 && failures.length === 0 };
}

export function report(result) {
  const lines = [`${result.name} v${result.version} on ${result.datasetName}: ${result.passed}/${result.total} passed`];
  for (const f of result.failures) lines.push(`  FAIL ${JSON.stringify(f.input)}: expected "${f.expected}", got "${f.got}"`);
  if (result.total === 0) lines.push('  The dataset has no active items.');
  return lines.join('\n');
}
