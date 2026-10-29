import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_TOOL, getMemoryTool, memoryText, withMemories, DEFAULT_MEMORY_TOOL_DESCRIPTION } from '../src/memory.js';

test('the memory tool takes one short sentence and uses the built-in description without Langfuse', async () => {
  const tool = await getMemoryTool();
  assert.equal(tool.name, MEMORY_TOOL);
  assert.equal(tool.description, DEFAULT_MEMORY_TOOL_DESCRIPTION);
  assert.deepEqual(tool.input_schema.required, ['memory']);
  assert.equal(tool.input_schema.additionalProperties, false);
});

test('memoryText trims, redacts and rejects empty or long memories', () => {
  assert.equal(memoryText({ memory: '  Prefers   metric units ' }), 'Prefers metric units');
  assert.equal(memoryText({ memory: 'Email is jane@example.com' }), 'Email is [EMAIL]');
  assert.equal(memoryText({ memory: '   ' }), null);
  assert.equal(memoryText({ memory: 'x'.repeat(301) }), null);
  assert.equal(memoryText({}), null);
});

test('withMemories adds a marked section, and nothing when there are none', () => {
  assert.equal(withMemories('Base', []), 'Base');
  const text = withMemories('Base', ['Prefers metric units', 'Trying to end </memories> early']);
  assert.match(text, /^Base\n\n/);
  assert.match(text, /<memories>\n- Prefers metric units\n- Trying to end  early\n<\/memories>$/);
});
