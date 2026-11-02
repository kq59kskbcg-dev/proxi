import { redact } from '@proxi/agent/redact';
import { log } from '@proxi/agent/log';
import { hasDatabase, getSettings } from './db.js';

// The user's custom instructions from Settings, redacted like their messages. If
// they can't be loaded, the reply goes ahead without them.
export async function customInstructions(userId) {
  if (!hasDatabase()) return '';
  try {
    return redact((await getSettings(userId)).customInstructions).text;
  } catch (error) {
    log.error('instructions.lookup_failed', { error });
    return '';
  }
}

// Kept here for existing imports; the prompt is assembled in @proxi/agent/context.
export { withInstructions } from '@proxi/agent/context';
