// Memory: the model suggests a fact with the save_memory tool, the page shows it in a
// "Save to memory" card, and only the card's Save button (POST /api/memories) stores it.

import { randomUUID } from 'node:crypto';
import { memoryText, cleanMemory } from '@proxi/agent/memory';
import { listMemories, addMemory, MEMORY_LIMIT } from './db.js';

// The user's saved memories as plain text. A failed lookup means no memories, not a failed reply.
export async function savedMemories(userId) {
  try {
    return (await listMemories(userId)).map((m) => m.content);
  } catch (error) {
    console.error('memory lookup failed', error?.code ?? error?.name);
    return [];
  }
}

// Runs the model's save_memory calls for one reply: shows the card, saves nothing. `show(text)`
// puts the card on the page. One card per reply. `saved` is the user's saved memories.
export function memoryOffer(show, saved = []) {
  let shown = null;
  const run = (call) => {
    const reply = (content, isError = false) => ({ type: 'tool_result', tool_use_id: call.id, content, is_error: isError });
    if (shown) return reply('A memory card is already showing in this reply.', true);
    const text = memoryText(call.input);
    if (!text) return reply('Not shown: the memory was empty or longer than one short sentence.', true);
    if (saved.includes(text)) return reply('This is already saved.');
    if (saved.length >= MEMORY_LIMIT) return reply('Not shown: memory is full. The user can delete memories in Settings.', true);
    shown = text;
    show(text);
    return reply('The card is showing under your reply. The user can edit it and press Save. Nothing is saved yet.');
  };
  return { run, shown: () => shown };
}

// The card's Save button. Returns { outcome: "saved" | "duplicate" | "full", text } or
// { outcome: "invalid" } when the text is empty or too long.
export async function saveFromCard(userId, value) {
  const text = cleanMemory(value);
  if (!text) return { outcome: 'invalid' };
  return { outcome: await addMemory(userId, randomUUID(), text), text };
}
