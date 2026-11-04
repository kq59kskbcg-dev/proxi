// "Message Lisandro": when someone asks for a person, the model can show a card under its reply
// with a short summary of what they need. They add an email for the reply and press Send, and
// POST /api/contact emails the summary to Lisandro through the MCP server. Nothing is sent before
// they press Send, and the address goes from the card to the server without reaching the model.

import { redact } from '@proxi/agent/redact';
import { getMcpTools, ESCALATION_EMAIL_TOOL } from '@proxi/agent/mcp';

export const CONTACT_TOOL = 'offer_message_to_lisandro';
export const CONTACT_SUMMARY_MAX = 600;
// One address, without spaces, angle brackets or commas. The MCP server checks it again.
export const EMAIL = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[A-Za-z]{2,24}$/;

// Spam guard: per user, in each function instance's memory, like ratelimit.js.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS = 3;
const sends = new Map();

export const CONTACT_TOOL_DEFINITION = {
  name: CONTACT_TOOL,
  description: `Show the user a card for sending a message to Lisandro, who built and runs Proxi.
Use it when the user wants to talk to a person, once you know what they need. If that isn't clear yet, ask first.
The card shows your summary and asks for their email address. Nothing is sent until they press Send.
Write the summary in one to three short sentences, in the third person and in the user's language: what they need, with details from the chat that help Lisandro answer. Leave out personal details the user didn't ask to share.
After calling it, tell the user in one sentence to add their email in the card and press Send. Never say the message was sent.`,
  input_schema: {
    type: 'object',
    properties: { summary: { type: 'string', description: 'What the user needs, in one to three short sentences.' } },
    required: ['summary'],
    additionalProperties: false,
  },
};

// The summary to show, redacted like messages, or null when it can't be used.
export function contactSummary(value) {
  const raw = typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (!raw || raw.length > CONTACT_SUMMARY_MAX) return null;
  return redact(raw).text;
}

// A card stored with a reply: { summary, sent }. Anything else is dropped.
export function contactField(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = contactSummary(value.summary);
  return summary ? { summary, sent: value.sent === true } : null;
}

// Whether the card can be offered in this chat: Proxi's email tool is reachable and someone asked
// for a person, in this message or earlier in the chat.
export async function contactAvailable(escalated) {
  if (!escalated) return false;
  const mcp = await getMcpTools();
  return !!mcp?.has(ESCALATION_EMAIL_TOOL);
}

// Runs the model's call to show the card. `show(summary)` puts the card on the page. Only one card
// per reply.
export function contactOffer(show) {
  let shown = null;
  const run = (call) => {
    const reply = (content, isError = false) => ({ type: 'tool_result', tool_use_id: call.id, content, is_error: isError });
    if (shown) return reply('The card is already showing in this reply.', true);
    const summary = contactSummary(call.input?.summary);
    if (!summary) return reply(`Not shown: the summary was empty or longer than ${CONTACT_SUMMARY_MAX} characters.`, true);
    shown = summary;
    show(summary);
    return reply('The card is showing under your reply. The user can add their email and press Send. Nothing has been sent yet.');
  };
  return { run, shown: () => shown };
}

export function contactLimit(userId) {
  const now = Date.now();
  const recent = (sends.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_SENDS) return { ok: false, retryAfter: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  recent.push(now);
  sends.set(userId, recent);
  if (sends.size > 5000) sends.clear();
  return { ok: true };
}

// Sends the email. Resolves to 'sent', 'unavailable' (not set up) or 'failed'.
export async function sendContact(summary, replyTo) {
  const mcp = await getMcpTools();
  if (!mcp?.has(ESCALATION_EMAIL_TOOL)) return 'unavailable';
  const result = await mcp.callDirect(ESCALATION_EMAIL_TOOL, { summary, reply_to: replyTo });
  if (!result.ok) console.error('escalation email failed');
  return result.ok ? 'sent' : 'failed';
}
