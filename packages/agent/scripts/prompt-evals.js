// Runs a prompt version over its eval dataset in Langfuse. Used by `npm run eval` and
// `npm run promote`, so a prompt only reaches production after it passes.

import { TITLE_MODEL } from '../src/title.js';
import { detectLanguage } from '../src/locale.js';
import { wantsPerson } from '../src/escalation.js';

// Prompts that have an eval. Each dataset item has the prompt's variables as its input and
// the exact expected reply as its expected output.
export const DATASETS = {
  'classifiers/language': 'evals/classifier-language',
  'classifiers/escalation': 'evals/classifier-escalation',
};

async function activeItems(langfuse, datasetName) {
  const { data } = await langfuse.api.datasetItemsList({ datasetName, limit: 100 });
  return data.filter((item) => item.status !== 'ARCHIVED');
}

// Asks for each item's answer and compares it with the expected output, exactly.
async function score(name, version, datasetName, items, answer) {
  const failures = [];
  for (const item of items) {
    const got = String(await answer(item.input)).trim().toLowerCase();
    const expected = String(item.expectedOutput).toLowerCase();
    if (got !== expected) failures.push({ input: item.input, expected, got });
  }
  return { name, version, datasetName, total: items.length, passed: items.length - failures.length, failures, ok: items.length > 0 && failures.length === 0 };
}

// One prompt version, called directly with the same model and settings the app uses.
export async function evalPrompt(langfuse, client, name, version) {
  const datasetName = DATASETS[name];
  if (!datasetName) throw new Error(`No eval dataset for "${name}"`);
  const prompt = await langfuse.getPrompt(name, version, { cacheTtlSeconds: 0 });
  const items = await activeItems(langfuse, datasetName);
  return score(name, version, datasetName, items, async (input) => {
    const res = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 8,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt.compile(input) }],
    }, { timeout: 15_000, maxRetries: 1 });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  });
}

// The agent's own code and the production prompt together, as the app runs them. This is what
// CI runs, so a change to the agent code is checked and not only a change to a prompt.
const LIVE = {
  'classifiers/language': (langfuse, client, input) => detectLanguage(langfuse, client, input.message),
  'classifiers/escalation': (langfuse, client, input) => wantsPerson(langfuse, client, input.message),
};

export async function evalLive(langfuse, client, name) {
  const datasetName = DATASETS[name];
  if (!datasetName) throw new Error(`No eval dataset for "${name}"`);
  // A prompt that has never been promoted has nothing live to check yet: the app uses its
  // built-in fallback. Promoting it runs its eval first.
  try {
    await langfuse.getPrompt(name, undefined, { label: 'production', cacheTtlSeconds: 0 });
  } catch (err) {
    if (!/not found/i.test(String(err?.message))) throw err;
    return { name, version: 'production', datasetName, total: 0, passed: 0, failures: [], ok: true, skipped: true };
  }
  const items = await activeItems(langfuse, datasetName);
  return score(name, 'production', datasetName, items, (input) => LIVE[name](langfuse, client, input));
}

export function report(result) {
  if (result.skipped) return `${result.name}: skipped, no production version yet`;
  const lines = [`${result.name} ${typeof result.version === 'number' ? `v${result.version}` : result.version} on ${result.datasetName}: ${result.passed}/${result.total} passed`];
  for (const f of result.failures) lines.push(`  FAIL ${JSON.stringify(f.input)}: expected "${f.expected}", got "${f.got}"`);
  if (result.total === 0) lines.push('  The dataset has no active items.');
  return lines.join('\n');
}
