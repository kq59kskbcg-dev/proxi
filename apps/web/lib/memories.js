import { randomUUID } from 'node:crypto';
import { memoryText } from '@proxi/agent/memory';
import { log } from '@proxi/agent/log';
import { listMemories, addMemory } from './db.js';

// The user's saved memories as plain text. A failed lookup means no memories, not a failed reply.
export async function savedMemories(userId) {
  try {
    return (await listMemories(userId)).map((m) => m.content);
  } catch (error) {
    log.error('memories.lookup_failed', { error });
    return [];
  }
}

// Runs the save_memory tool for the signed-in user.
export async function remember(userId, call) {
  const reply = (content, isError = false) => ({ type: 'tool_result', tool_use_id: call.id, content, is_error: isError });
  const text = memoryText(call.input);
  if (!text) return reply('Not saved: the memory was empty or longer than one short sentence.', true);
  try {
    const outcome = await addMemory(userId, randomUUID(), text);
    if (outcome === 'duplicate') return reply('This is already saved.');
    if (outcome === 'full') return reply('Not saved: memory is full. The user can delete memories in Settings.', true);
    return reply('Saved to memory.');
  } catch (error) {
    log.error('memories.save_failed', { error });
    return reply('Saving to memory failed.', true);
  }
}
