import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODEL_LABELS } from '@proxi/agent/models';
import { modelLabel } from '../ui/format.js';

// The browser can't import from packages, so ui/format.js keeps its own copy of the labels.
test('the page shows the same model labels as the server', () => {
  for (const [id, label] of Object.entries(MODEL_LABELS)) assert.equal(modelLabel(id), label);
  const source = readFileSync(new URL('../ui/format.js', import.meta.url), 'utf8');
  const ids = [...source.match(/const MODEL_LABELS = \{([^}]*)\}/)[1].matchAll(/'(claude-[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), Object.keys(MODEL_LABELS).sort());
});
