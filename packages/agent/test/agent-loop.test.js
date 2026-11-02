import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/agent-loop.js';

const delta = (text) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
const citation = (source) => ({ type: 'content_block_delta', delta: { type: 'citations_delta', citation: { source, title: source } } });
const stop = { type: 'content_block_stop' };
const toolUse = (id, name) => ({ type: 'tool_use', id, name, input: {} });

// A fake MessageStream: yields the events, then resolves finalMessage() to the message.
function fakeStream(events, message) {
  return {
    async *[Symbol.asyncIterator]() { yield* events; },
    finalMessage: async () => ({ model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [], ...message }),
  };
}

// Runs the loop over scripted rounds; each round is [events, message].
async function run(rounds, options = {}) {
  const opened = [];
  const events = [];
  const executed = [];
  const result = await runAgentLoop({
    open: (turns) => { opened.push(structuredClone(turns)); const [ev, msg] = rounds.shift(); return fakeStream(ev, msg); },
    messages: [{ role: 'user', content: 'Hi' }],
    toolsEnabled: true,
    executeTool: async (call) => { executed.push(call.name); return { type: 'tool_result', tool_use_id: call.id, content: `ran ${call.name}` }; },
    onEvent: (event) => events.push(event),
    maxRounds: 5,
    ...options,
  });
  return { result, opened, events, executed, left: rounds.length };
}

const texts = (events) => events.filter((e) => e.type === 'text').map((e) => e.text);

test('a reply without tools is streamed as text and returned with its usage', async () => {
  const { result, events, opened } = await run([[[delta('Hello'), delta(' there'), stop], { stop_reason: 'end_turn' }]]);
  assert.deepEqual(texts(events), ['Hello', ' there']);
  assert.equal(result.text, 'Hello there');
  assert.equal(result.final.stop_reason, 'end_turn');
  assert.deepEqual(result.usage, { input: 10, output: 5 });
  assert.equal(opened.length, 1);
});

test('tool calls are announced, run, and their results sent back', async () => {
  const calls = [toolUse('t1', 'search_docs'), toolUse('t2', 'save_memory')];
  const { result, events, opened, executed } = await run([
    [[delta('Let me check.'), stop], { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Let me check.' }, ...calls] }],
    [[delta('Found it.'), stop], { stop_reason: 'end_turn' }],
  ]);
  assert.deepEqual(executed, ['search_docs', 'save_memory']);
  const announced = events.find((e) => e.type === 'tool_calls');
  assert.deepEqual(announced.calls.map((c) => c.id), ['t1', 't2']);
  assert.ok(events.indexOf(announced) < events.findIndex((e) => e.text?.includes('Found')));
  assert.deepEqual(opened[1].slice(1), [
    { role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, ...calls] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ran search_docs' }, { type: 'tool_result', tool_use_id: 't2', content: 'ran save_memory' }] },
  ]);
  assert.equal(result.text, 'Let me check.\n\nFound it.', 'a later round starts a new paragraph');
  assert.deepEqual(result.usage, { input: 20, output: 10 });
});

test('the first text of a reply that starts with a tool call has no leading gap', async () => {
  const { result } = await run([
    [[], { stop_reason: 'tool_use', content: [toolUse('t1', 'get_status')] }],
    [[delta('All good.'), stop], { stop_reason: 'end_turn' }],
  ]);
  assert.equal(result.text, 'All good.');
});

test('the loop stops after maxRounds even if the model keeps asking for tools', async () => {
  const round = () => [[], { stop_reason: 'tool_use', content: [toolUse('t', 'get_status')] }];
  const { result, opened, executed } = await run([round(), round(), round(), round()], { maxRounds: 2 });
  assert.equal(opened.length, 2);
  assert.equal(executed.length, 1);
  assert.equal(result.final.stop_reason, 'tool_use');
});

test('without tools a tool_use stop ends the loop', async () => {
  const { opened, executed } = await run([[[], { stop_reason: 'tool_use', content: [toolUse('t', 'x')] }]], { toolsEnabled: false });
  assert.equal(opened.length, 1);
  assert.deepEqual(executed, []);
});

test('cited blocks get a marker, repeats are dropped, and Sources come last', async () => {
  const { result } = await run([[[
    citation('https://a.example'), delta('One.'), stop,
    citation('https://a.example'), delta('Two.'), stop,
    citation('https://b.example'), delta('Three.'), stop,
  ], { stop_reason: 'end_turn' }]]);
  assert.equal(result.text, 'One. [[1]](https://a.example)Two.Three. [[2]](https://b.example)'
    + '\n\n**Sources**\n1. [https://a.example](https://a.example)\n2. [https://b.example](https://b.example)');
});

test('the marker of the last block resets in a new round', async () => {
  const { result } = await run([
    [[citation('https://a.example'), delta('One.'), stop], { stop_reason: 'tool_use', content: [toolUse('t', 'x')] }],
    [[citation('https://a.example'), delta('Two.'), stop], { stop_reason: 'end_turn' }],
  ]);
  assert.match(result.text, /^One\. \[\[1\]\]\(https:\/\/a\.example\)\n\nTwo\. \[\[1\]\]\(https:\/\/a\.example\)\n\n\*\*Sources\*\*/);
});

test('a refusal is returned as the final message for the caller to handle', async () => {
  const { result } = await run([[[], { stop_reason: 'refusal', model: 'claude-opus-5-5' }]]);
  assert.equal(result.final.stop_reason, 'refusal');
  assert.equal(result.final.model, 'claude-opus-5-5');
  assert.equal(result.text, '');
});

test('a stream error is thrown, after the text sent so far', async () => {
  const events = [];
  await assert.rejects(runAgentLoop({
    open: () => ({
      async *[Symbol.asyncIterator]() { yield delta('Partial'); throw new Error('aborted'); },
      finalMessage: async () => { throw new Error('unreachable'); },
    }),
    messages: [], toolsEnabled: true, executeTool: async () => ({}), onEvent: (e) => events.push(e), maxRounds: 5,
  }), /aborted/);
  assert.deepEqual(texts(events), ['Partial']);
});
