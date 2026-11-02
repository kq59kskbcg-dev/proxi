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

// Kept here for existing imports; the prompt is assembled in @proxi/agent/context.
export { withInstructions } from '@proxi/agent/context';
