import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, pageOf, pageRetrieved } from '../lib/evidence.js';
import { JUDGES, judgeVariables, parseScore, runJudge } from '../lib/judges.js';
import { evaluateGate } from '../lib/gate.js';

const doc = (source, text) => ({ type: 'search_result', source, title: source, content: [{ type: 'text', text }] });
const toolLog = [{ name: 'search_docs', input: { query: 'retention' }, result: { content: [
  doc('https://proxi.mintlify.site/privacy-policy', 'Chats are deleted after 30 days.'),
  doc('https://proxi.mintlify.site/privacy', 'Retention policy.'),
] } }];
const events = [{ type: 'start', traceId: 't1' }, { type: 'text', text: 'Thirty ' }, { type: 'text', text: 'days.' }, { type: 'done' }];

test('pageOf turns a docs URL into the page name', () => {
  assert.equal(pageOf('https://proxi.mintlify.site/privacy'), 'privacy');
  assert.equal(pageOf('https://proxi.mintlify.site/'), 'index');
  assert.equal(pageOf('https://proxi.mintlify.site/privacy-policy/'), 'privacy-policy');
});

test('collectEvidence gathers the reply, tool calls and retrieved docs', () => {
  const evidence = collectEvidence(events, toolLog);
  assert.equal(evidence.output, 'Thirty days.');
  assert.deepEqual(evidence.toolCalls, [{ name: 'search_docs', input: { query: 'retention' } }]);
  assert.deepEqual(evidence.retrieved.map((d) => d.page), ['privacy-policy', 'privacy']);
  assert.match(evidence.context, /\[privacy-policy\] Chats are deleted after 30 days\./);
  assert.equal(evidence.error, null);
  assert.equal(collectEvidence([{ type: 'error', error: 'boom' }], []).error, 'boom');
});

test('pageRetrieved needs the expected page among the first three distinct pages', () => {
  const evidence = collectEvidence(events, toolLog);
  assert.equal(pageRetrieved(evidence, 'privacy'), true);
  assert.equal(pageRetrieved(evidence, 'security'), false);
  assert.equal(pageRetrieved(collectEvidence(events, []), 'privacy'), false);
});

test('parseScore reads the judge JSON and rejects anything else', () => {
  assert.deepEqual(parseScore('Here: {"score": 5, "reason": "Accurate."}'), { score: 5, reason: 'Accurate.' });
  assert.equal(parseScore('{"score": 7, "reason": "x"}').score, null);
  assert.equal(parseScore('{"score": 3.5, "reason": "x"}').score, null);
  assert.equal(parseScore('no json').score, null);
  assert.equal(parseScore('{broken').score, null);
});

test('judgeVariables fills every variable the judge prompts use', () => {
  const evidence = collectEvidence(events, toolLog);
  const vars = judgeVariables({ question: 'How long?', reference: '30 days' }, evidence);
  assert.equal(vars.input, 'How long?');
  assert.equal(vars.output, 'Thirty days.');
  assert.equal(vars.reference, '30 days');
  assert.match(vars.tool_calls, /search_docs\(\{"query":"retention"\}\)/);
  assert.equal(judgeVariables({ question: 'q', reference: 'r' }, collectEvidence([], [])).tool_calls, '(no tools were called)');
});

test('runJudge loads evals/<name>, asks for JSON and returns the score', async () => {
  let asked; let sent;
  const langfuse = { getPrompt: async (name, version, options) => { asked = { name, options }; return { compile: (v) => `Judge ${v.output}` }; } };
  const client = { messages: { create: async (params) => { sent = params; return { content: [{ type: 'text', text: '{"score": 4, "reason": "Fine."}' }] }; } } };
  const result = await runJudge(langfuse, client, 'tone', { output: 'Hi' });
  assert.deepEqual(result, { score: 4, reason: 'Fine.' });
  assert.equal(asked.name, 'evals/tone');
  assert.equal(asked.options.label, 'latest');
  assert.match(sent.messages[0].content, /^Judge Hi[\s\S]*JSON only/);
});

const passing = (id) => ({ id, pageRetrieved: true, scores: Object.fromEntries(Object.keys(JUDGES).map((j) => [j, 5])) });

test('the gate passes when every score is high and every page is found', () => {
  const gate = evaluateGate([passing('a'), passing('b')]);
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.problems, []);
});

test('the gate fails on a hard judge below 4, a missing page or a missing score', () => {
  const low = passing('a'); low.scores.correctness = 3;
  assert.match(evaluateGate([low, passing('b')]).problems[0], /a: correctness scored 3/);
  const missed = passing('a'); missed.pageRetrieved = false;
  assert.match(evaluateGate([missed]).problems[0], /expected page/);
  const unscored = passing('a'); unscored.scores.privacy = null;
  assert.match(evaluateGate([unscored]).problems[0], /no privacy score/);
});

test('soft judges fail on an item below 3 or an average below 4, but not on a single 3 or 4', () => {
  const okay = passing('a'); okay.scores.tone = 3;
  assert.equal(evaluateGate([okay, passing('b'), passing('c'), passing('d')]).ok, true);
  const bad = passing('a'); bad.scores.tone = 2;
  assert.match(evaluateGate([bad, passing('b'), passing('c'), passing('d')]).problems[0], /a: tone scored 2/);
  const a = passing('a'); const b = passing('b'); a.scores.tone = 3; b.scores.tone = 3;
  assert.match(evaluateGate([a, b]).problems[0], /tone: average 3\.00/);
  assert.equal(evaluateGate([]).ok, false);
});
