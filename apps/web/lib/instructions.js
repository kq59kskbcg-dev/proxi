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

// The tools the user turned off in Settings, as a Set of tool names. If they can't be loaded,
// every tool stays on.
export async function disabledTools(userId) {
  if (!hasDatabase()) return new Set();
  try {
    return new Set((await getSettings(userId)).disabledTools);
  } catch (error) {
    console.error('tool settings lookup failed', error?.code ?? error?.name);
    return new Set();
  }
}

// Kept here for existing imports; the prompt is assembled in @proxi/agent/context.
export { withInstructions } from '@proxi/agent/context';
