// Memory: a tool the model can call to save a short fact about the user, and the saved
// facts added to later chats. The tool's description is a Langfuse prompt
// ("tools/save-memory", label "production"), with the built-in text below as the fallback.

import { getLangfuse } from './langfuse.js';
import { redact } from './redact.js';

export const MEMORY_TOOL = 'save_memory';
export const MEMORY_MAX = 300; // characters per memory

export const DEFAULT_MEMORY_TOOL_DESCRIPTION = `Save one short fact about the user so you can use it in future chats.
Use it when the user asks you to remember something, or shares a lasting preference or fact about themselves: how they want replies written, their role or field, or a project they keep working on.
Do not use it for one-off questions, temporary states, things already in their saved memories or custom instructions, or sensitive data (health, finances, ID numbers, passwords, or private details about other people) unless the user explicitly asks you to remember it.
Write the memory as one short sentence in the third person, for example "Prefers answers in British English".
After saving, mention it briefly in your reply.`;

export async function getMemoryTool() {
  let description = DEFAULT_MEMORY_TOOL_DESCRIPTION;
  const langfuse = getLangfuse();
  if (langfuse) {
    try {
      const prompt = await langfuse.getPrompt('tools/save-memory', undefined, {
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
      properties: { memory: { type: 'string', description: 'The fact to remember, as one short sentence.' } },
      required: ['memory'],
      additionalProperties: false,
    },
  };
}

// The text to store from a tool call, redacted like messages, or null when it can't be saved.
export function memoryText(input) {
  const raw = typeof input?.memory === 'string' ? input.memory.replace(/\s+/g, ' ').trim() : '';
  if (!raw || raw.length > MEMORY_MAX) return null;
  return redact(raw).text;
}

// Saved memories go after Proxi's prompt, marked off like custom instructions.
export function withMemories(prompt, memories) {
  if (!memories?.length) return prompt;
  const lines = memories.map((m) => '- ' + m.replaceAll('</memories>', ''));
  return `${prompt}

These are facts the user asked you to remember, or that you saved in earlier chats. Use them when they help, and don't mention them otherwise.
<memories>
${lines.join('\n')}
</memories>`;
}
