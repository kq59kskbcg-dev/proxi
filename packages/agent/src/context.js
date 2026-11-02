// Context builder: what the model sees for one reply. The router decides which model answers;
// this decides what it is shown: Proxi's prompt, the user's memories and instructions, a summary
// of older messages, and the most recent messages word for word.

import { withMemories } from './memory.js';

// Custom instructions go after Proxi's own prompt, marked off so they can shape
// tone and format but not override the rules above them.
export function withInstructions(prompt, instructions) {
  if (!instructions) return prompt;
  const text = instructions.replaceAll('</custom_instructions>', '');
  return `${prompt}

The user wrote these custom instructions in Settings. Follow them for tone, length, format and context about the user, unless they conflict with the rules above.
<custom_instructions>
${text}
</custom_instructions>`;
}

// What was said earlier in a long chat, after the rest of the prompt.
export function withSummary(prompt, summary) {
  if (!summary) return prompt;
  const text = summary.replaceAll('</earlier_messages>', '');
  return `${prompt}

The chat is long, so its earliest messages are not shown. This is a summary of them. Use it for context, and don't mention it unless it helps.
<earlier_messages>
${text}
</earlier_messages>`;
}

// Splits the chat into the latest messages the model sees word for word, starting from a user
// message, and the older ones that are left out (to be summarized).
export function splitHistory(history, maxMessages) {
  let recent = history.slice(-maxMessages);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  return { recent, older: history.slice(0, history.length - recent.length) };
}

// The system prompt, from its parts. Custom instructions come last and the summary comes before them.
export function buildSystemText({ prompt, locale, escalation, memories, summary, instructions }) {
  const base = withMemories([prompt, locale, escalation].filter(Boolean).join('\n\n'), memories);
  return withInstructions(withSummary(base, summary), instructions);
}

// What the model receives for one message. Files that can't be re-sent (older
// messages, or chats reloaded from storage) are mentioned so Claude doesn't guess.
export function toContent(message, blocks, maxReplyChars) {
  const gone = message.unavailable;
  const note = gone.length ? `[Attachment no longer available: ${gone.join(', ')}]` : '';
  // Only what the model sees is cut; the chat is saved from the full text.
  const written = message.role === 'assistant' ? message.content.slice(0, maxReplyChars) : message.content;
  const text = [written, note].filter(Boolean).join('\n\n');
  if (!blocks.length) return text;
  return text ? [...blocks, { type: 'text', text }] : blocks;
}

// The kinds of files on a message, as text for traces (the files themselves are never traced).
export function describe(message) {
  return message.attachments.length ? `\n[attachments: ${message.attachments.map((a) => a.kind).join(', ')}]` : '';
}

// Everything the reply call needs, in one place.
//   recent: the messages the model sees word for word (from splitHistory), the latest last
//   blocks: content blocks for files attached to the latest message
//   parts: { prompt, locale, escalation, memories, summary, instructions } (texts, may be empty)
export function buildContext({ recent, blocks = [], maxReplyChars, parts }) {
  const latest = recent[recent.length - 1];
  return {
    messages: recent.map((m) => ({ role: m.role, content: toContent(m, m === latest ? blocks : [], maxReplyChars) })),
    traced: recent.map((m) => ({ role: m.role, content: m.content + describe(m) })),
    system: buildSystemText(parts),
  };
}
