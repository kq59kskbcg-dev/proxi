import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODEL_LABELS, SELECTABLE_MODELS, FALLBACK_MODELS, ROUTE_MODELS, CLASSIFIER_MODEL, SEARCH_MODEL, HAIKU } from '../src/models.js';

test('every selectable model has a label, and labels map back to their model', () => {
  for (const [label, id] of Object.entries(SELECTABLE_MODELS)) assert.equal(MODEL_LABELS[id], label);
  assert.equal(Object.keys(SELECTABLE_MODELS).length, Object.keys(MODEL_LABELS).length);
});

test('fallback, routing and classifier models are all known models', () => {
  for (const id of [...FALLBACK_MODELS, ...Object.values(ROUTE_MODELS), CLASSIFIER_MODEL, SEARCH_MODEL]) assert.ok(MODEL_LABELS[id], id);
  assert.equal(FALLBACK_MODELS.has(HAIKU), false, 'Haiku has no server-side fallback');
});

// apps/mcp is not an npm workspace, so it can't import models.js; its copy must match.
test('the MCP web search uses the same search model', () => {
  const source = readFileSync(new URL('../../../apps/mcp/lib/websearch.js', import.meta.url), 'utf8');
  assert.equal(source.match(/const SEARCH_MODEL = '([^']+)'/)?.[1], SEARCH_MODEL);
});
