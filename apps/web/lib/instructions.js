import { redact } from '@proxi/agent/redact';
import { hasDatabase, getSettings } from './db.js';

// The user's custom instructions from Settings, redacted like their messages. If
// they can't be loaded, the reply goes ahead without them.
export async function customInstructions(userId) {
  if (!hasDatabase()) return '';
  try {
    return redact((await getSettings(userId)).customInstructions).text;
  } catch (error) {
    console.error('custom instructions lookup failed', error?.code ?? error?.name);
    return '';
  }
}

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
