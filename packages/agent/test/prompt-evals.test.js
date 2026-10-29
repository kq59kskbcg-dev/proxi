import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalPrompt, report } from '../scripts/prompt-evals.js';

const items = [
  { status: 'ACTIVE', input: { message: 'Hola' }, expectedOutput: 'es' },
  { status: 'ACTIVE', input: { message: 'Hello' }, expectedOutput: 'en' },
  { status: 'ARCHIVED', input: { message: 'ignored' }, expectedOutput: 'xx' },
];
const langfuse = {
  getPrompt: async (name, version) => ({ compile: ({ message }) => `${name}@${version}: ${message}` }),
  api: { datasetItemsList: async () => ({ data: items }) },
};
const answering = (answers) => ({ messages: { create: async (params) => {
  answering.sent.push(params);
  return { content: [{ type: 'text', text: answers[params.messages[0].content] }] };
} } });
answering.sent = [];

test('evalPrompt passes when every active item gets exactly the expected reply', async () => {
  const client = answering({ 'classifiers/language@3: Hola': ' ES\n', 'classifiers/language@3: Hello': 'en' });
  const result = await evalPrompt(langfuse, client, 'classifiers/language', 3);
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.deepEqual(answering.sent[0].thinking, { type: 'disabled' });
  assert.match(report(result), /2\/2 passed/);
});

test('evalPrompt fails and lists the items that got the wrong reply', async () => {
  const client = answering({ 'classifiers/language@4: Hola': 'es', 'classifiers/language@4: Hello': 'It is English' });
  const result = await evalPrompt(langfuse, client, 'classifiers/language', 4);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(report(result), /FAIL .*Hello.*expected "en", got "it is english"/);
});

test('evalPrompt fails on an empty dataset and rejects prompts without an eval', async () => {
  const empty = { ...langfuse, api: { datasetItemsList: async () => ({ data: [] }) } };
  assert.equal((await evalPrompt(empty, answering({}), 'classifiers/language', 1)).ok, false);
  await assert.rejects(() => evalPrompt(langfuse, answering({}), 'evals/tone', 1), /No eval dataset/);
});

test('evalLive runs the agent code with the production prompt and compares exactly', async () => {
  const lf = {
    getPrompt: async () => ({ compile: ({ message }) => `Q: ${message}` }),
    api: { datasetItemsList: async () => ({ data: [{ status: 'ACTIVE', input: { message: 'I want a human' }, expectedOutput: true }] }) },
  };
  const { evalLive } = await import('../scripts/prompt-evals.js');
  const ok = await evalLive(lf, answering({ 'Q: I want a human': 'true' }), 'classifiers/escalation');
  assert.equal(ok.ok, true);
  assert.equal(ok.version, 'production');
  assert.match(report(ok), /classifiers\/escalation production on .*: 1\/1 passed/);
  const bad = await evalLive(lf, answering({ 'Q: I want a human': 'false' }), 'classifiers/escalation');
  assert.equal(bad.ok, false);
});

test('evalLive skips a prompt that has no production version yet', async () => {
  const lf = {
    getPrompt: async () => { throw new Error("Prompt not found: 'classifiers/language' with label 'production'"); },
    api: { datasetItemsList: async () => { throw new Error('should not list items'); } },
  };
  const { evalLive } = await import('../scripts/prompt-evals.js');
  const result = await evalLive(lf, answering({}), 'classifiers/language');
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(report(result), /skipped, no production version yet/);
});
