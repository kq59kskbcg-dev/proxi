// Memory: a tool the model can call to suggest a short fact about the user, and the saved
// facts added to later chats. A suggestion is shown in a "Save to memory" card under the reply;
// nothing is saved until the user presses Save (POST /api/memories). The tool's description is a Langfuse prompt
// ("tools/save-memory", label "production"), with the built-in text below as the fallback.

import { getLangfuse } from './langfuse.js';
import { redact } from './redact.js';

export const MEMORY_TOOL = 'save_memory';
export const MEMORY_MAX = 300; // characters per memory

// What a suggestion's card can be: waiting for an answer, saved, or declined (Not now, or another
// message sent without saving).
export const MEMORY_STATUSES = new Set(['pending', 'saved', 'declined']);

export const DEFAULT_MEMORY_TOOL_DESCRIPTION = `Suggest one short fact about the user to remember in future chats. It is shown in a card under your reply, where the user can edit it and press Save. Nothing is saved until they do.
Use it when the user asks you to remember something, or shares a lasting preference or fact about themselves: how they want replies written, their role or field, or a project they keep working on.
Do not use it for one-off questions, temporary states, things already in their saved memories or custom instructions, suggestions the user declined earlier in this chat, or sensitive data (health, finances, ID numbers, passwords, or private details about other people) unless the user explicitly asks you to remember it.
Write the memory as one short sentence in the third person, for example "Prefers answers in British English".
After calling it, tell the user in one short sentence to check the card and press Save if it looks right. Never say it was saved.`;

export async function getMemoryTool() {
  let description = DEFAULT_MEMORY_TOOL_DESCRIPTION;
  const langfuse = getLangfuse();
  if (langfuse) {
    try {
      const prompt = await langfuse.prompt.get('tools/save-memory', {
        label: 'production', fallback: DEFAULT_MEMORY_TOOL_DESCRIPTION, cacheTtlSeconds: 60, fetchTimeoutMs: 2000,
      });
      description = prompt.compile();
    } catch {
      // Keep the built-in description.
    }
  }
  return {
    name: MEMORY_TOOL,
    description,
    input_schema: {
      type: 'object',
      properties: { memory: { type: 'string', description: 'The fact to suggest remembering, as one short sentence.' } },
      required: ['memory'],
      additionalProperties: false,
    },
  };
}

// The text to show or store from a tool call, redacted like messages, or null when it can't be used.
export function memoryText(input) {
  return cleanMemory(input?.memory);
}

// The same for text the user may have changed in the card.
export function cleanMemory(value) {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!raw || raw.length > MEMORY_MAX) return null;
  return redact(raw).text;
}

// A suggestion's card stored with a reply: { text, status }. Anything else is dropped.
export function memoryField(value) {
  if (!value || typeof value !== 'object') return null;
  const text = cleanMemory(value.text);
  return text ? { text, status: MEMORY_STATUSES.has(value.status) ? value.status : 'pending' } : null;
}

// A reply that suggested a memory says so, and what the user did, so the model doesn't suggest it
// again or claim it was saved when it wasn't.
export function memoryNote(message) {
  const m = message.memory;
  if (message.role !== 'assistant' || !m?.text) return '';
  const outcome = m.status === 'saved' ? 'The user saved it.'
    : m.status === 'pending' ? 'The user has not answered yet. It is not saved.'
    : 'The user declined it. It is not saved. Don\'t suggest it again in this chat unless they ask.';
  return `[You suggested saving this memory: "${m.text}". ${outcome}]`;
}

// Saved memories go after Proxi's prompt, marked off like custom instructions.
export function withMemories(prompt, memories) {
  if (!memories?.length) return prompt;
  const lines = memories.map((m) => '- ' + m.replaceAll('</memories>', ''));
  return `${prompt}

These are facts the user approved for you to remember. Use them when they help, and don't mention them otherwise.
<memories>
${lines.join('\n')}
</memories>`;
}
