import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toClaudeContent } from '../src/mcp.js';

const page = (url, text) => ({ type: 'resource', resource: { uri: url, mimeType: 'text/plain', text, _meta: { title: 'Page' } } });

test('resources become citable search results', () => {
  const blocks = toClaudeContent({ content: [page('https://example.com/a', 'Passage A')] });
  assert.deepEqual(blocks, [{
    type: 'search_result', source: 'https://example.com/a', title: 'Page',
    content: [{ type: 'text', text: 'Passage A' }], citations: { enabled: true },
  }]);
});

test('text next to search results is wrapped as a search result, since the API rejects the mix', () => {
  const blocks = toClaudeContent({ content: [
    { type: 'text', text: 'The answer.' },
    page('https://example.com/a', 'Passage A'),
    page('https://example.com/b', 'Passage B'),
  ] });
  assert.ok(blocks.every((b) => b.type === 'search_result'), 'only search results in the tool result');
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0].content, [{ type: 'text', text: 'The answer.' }]);
  assert.equal(blocks[0].source, 'tool-output');
  assert.deepEqual(blocks.map((b) => b.citations.enabled), [true, true, true]);
  assert.deepEqual(blocks.slice(1).map((b) => b.source), ['https://example.com/a', 'https://example.com/b']);
});

test('text-only results stay plain text', () => {
  assert.deepEqual(toClaudeContent({ content: [{ type: 'text', text: 'No answer was found.' }] }),
    [{ type: 'text', text: 'No answer was found.' }]);
  assert.deepEqual(toClaudeContent({ content: [] }), [{ type: 'text', text: '(no output)' }]);
});
