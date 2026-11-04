// Escalation emails through Resend: when someone asks for a person, Proxi's web app sends Lisandro
// a short summary of what they want, with their address as Reply-To.
//
// Without a verified domain, Resend only sends from onboarding@resend.dev, and only to the
// address the Resend account was created with, so SUPPORT_EMAIL_TO must be that address.
// RESEND_FROM can name another sender once a domain is verified.

// RESEND_BASE_URL is for tests, which point it at a fake server.
const endpoint = () => (process.env.RESEND_BASE_URL?.trim() || 'https://api.resend.com') + '/emails';
const DEFAULT_FROM = 'Proxi <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

export const SUMMARY_MAX = 1000;
// One address, without spaces, angle brackets or commas, so it can't add recipients or headers.
export const EMAIL = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[A-Za-z]{2,24}$/;

export class EmailError extends Error {}

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY?.trim() && EMAIL.test(process.env.SUPPORT_EMAIL_TO?.trim() || '');
}

// The email for one escalation. The summary goes in as plain text, never HTML.
export function escalationEmail(summary, replyTo) {
  const firstLine = summary.split('\n')[0];
  return {
    from: process.env.RESEND_FROM?.trim() || DEFAULT_FROM,
    to: [process.env.SUPPORT_EMAIL_TO.trim()],
    reply_to: replyTo,
    subject: `Proxi: ${firstLine.length > 60 ? firstLine.slice(0, 60).trim() + '...' : firstLine}`,
    text: `Someone using Proxi asked to talk to a person.\n\n${summary}\n\nReply to this email to answer them at ${replyTo}.`,
  };
}

export async function sendEscalationEmail(summary, replyTo, { fetch = globalThis.fetch } = {}) {
  if (!emailConfigured()) throw new EmailError('Email is not set up.');
  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(escalationEmail(summary, replyTo)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('resend request failed', error?.name);
    throw new EmailError("The email couldn't be sent.");
  }
  if (!res.ok) {
    // Only the status: Resend's error text can repeat the addresses.
    console.error('resend rejected the email', res.status);
    throw new EmailError("The email couldn't be sent.");
  }
  const data = await res.json().catch(() => ({}));
  return { id: typeof data.id === 'string' ? data.id : null };
}
