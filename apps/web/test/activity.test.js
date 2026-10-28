import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolActivity } from '../lib/activity.js';

test('known tools get friendly wording, with the search query', () => {
  assert.deepEqual(toolActivity('search_docs', 'Search Proxi docs', { query: 'what gets masked' }),
    { label: 'Searching the help center for "what gets masked"', done: 'Searched the help center' });
  assert.deepEqual(toolActivity('get_status', 'Get status', {}),
    { label: "Checking Proxi's status", done: "Checked Proxi's status" });
});

test('long queries are shortened and missing ones are left out', () => {
  assert.match(toolActivity('search_docs', null, { query: 'x'.repeat(80) }).label, /for "x{50}\.\.\."$/);
  assert.equal(toolActivity('search_docs', null, {}).label, 'Searching the help center');
});

test('other tools fall back to their MCP title', () => {
  assert.deepEqual(toolActivity('web_search', 'Search the web', {}), { label: 'Using Search the web', done: 'Used Search the web' });
  assert.deepEqual(toolActivity('mystery', undefined, {}), { label: 'Using mystery', done: 'Used mystery' });
});
