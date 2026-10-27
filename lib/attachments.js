import { redact } from './redact.js';

// Turns the files attached to a message into Claude content blocks.
// Files are checked by their actual bytes, never by the name or type the browser
// claims. Nothing here is stored: files live in memory for one request.

export const MAX_ATTACHMENTS = 3;
export const MAX_TOTAL_BYTES = 3_000_000; // base64 adds a third, and Vercel caps request bodies at 4.5 MB
export const MAX_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES = 20; // images and PDFs cost far more tokens than text
export const KINDS = new Set(['image', 'pdf', 'text']);

// Errors whose message is safe to show to the user as is.
export class AttachmentError extends Error {}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// What the bytes really are, or null if it is not an image or PDF.
export function sniff(buf) {
  if (buf.subarray(0, 8).equals(PNG)) return { kind: 'image', mediaType: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mediaType: 'image/jpeg' };
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { kind: 'image', mediaType: 'image/gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'image', mediaType: 'image/webp' };
  }
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mediaType: 'application/pdf' };
  return null;
}

function decodeText(buf) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

// File names reach the model, so strip anything that could break out of a prompt.
export function cleanName(name) {
  const plain = String(name ?? '').replace(/[\u0000-\u001f\u007f"'`<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return redact(plain).text || 'file';
}

async function readPdf(buf) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text };
}

/**
 * items: [{ name, data }] with base64 data.
 * Returns { blocks, kinds, notices, redactions }, or throws AttachmentError.
 */
export async function processAttachments(items) {
  if (items.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
  }
  const blocks = [];
  const kinds = [];
  const notices = [];
  const redactions = {};
  let total = 0;

  for (const item of items) {
    const name = cleanName(item.name);
    if (typeof item.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      throw new AttachmentError(`${name} could not be read.`);
    }
    const buf = Buffer.from(item.data, 'base64');
    if (buf.length === 0) throw new AttachmentError(`${name} is empty.`);
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) throw new AttachmentError('Attachments can be up to 3 MB in total.');

    const found = sniff(buf);

    if (found?.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: found.mediaType, data: item.data } });
      kinds.push('image');
      continue;
    }

    if (found?.kind === 'pdf') {
      let pdf;
      try {
        pdf = await readPdf(buf);
      } catch {
        throw new AttachmentError(`${name} could not be read as a PDF. It may be damaged or password-protected.`);
      }
      if (pdf.pages > MAX_PDF_PAGES) {
        throw new AttachmentError(`${name} has ${pdf.pages} pages. PDFs can have up to ${MAX_PDF_PAGES} pages.`);
      }
      // A PDF can't be redacted, so what looks like card data or an IBAN blocks it.
      const counts = redact(pdf.text).counts;
      if (counts.CARD || counts.IBAN) {
        throw new AttachmentError(`${name} contains what looks like a card number or IBAN. PDFs can't be redacted, so Proxi didn't send it. Remove that part, or paste the text instead.`);
      }
      if (counts.EMAIL || counts.PHONE) {
        notices.push(`${name} has an email address or phone number. PDFs are sent as they are.`);
      } else if (!pdf.text.trim()) {
        notices.push(`${name} has no text, so it couldn't be checked for sensitive data.`);
      }
      blocks.push({ type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: item.data } });
      kinds.push('pdf');
      continue;
    }

    const text = decodeText(buf);
    if (text === null) {
      throw new AttachmentError(`${name} isn't supported. Attach images, PDFs or plain text files.`);
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new AttachmentError(`${name} is too long. Text files can have up to ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters.`);
    }
    const clean = redact(text);
    for (const [k, v] of Object.entries(clean.counts)) redactions[k] = (redactions[k] || 0) + v;
    const body = clean.text.replace(/<\/attached_file/gi, '<\\/attached_file');
    blocks.push({ type: 'text', text: `<attached_file name="${name}">\n${body}\n</attached_file>` });
    kinds.push('text');
  }

  return { blocks, kinds, notices, redactions };
}
