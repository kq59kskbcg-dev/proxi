// `search_docs`: keyword search over the help center, from the index built out of apps/docs
// (scripts/build-docs-index.js). It runs here, so no query leaves Proxi's own servers.

import { readFileSync } from 'node:fs';

const DOCS_SITE = 'https://proxi.mintlify.app';
const MAX_TEXT = 4000;
const K1 = 1.4;
const B = 0.75;

export class DocsSearchError extends Error {}

let loaded;
function load() {
  if (loaded) return loaded;
  let sections;
  try {
    sections = JSON.parse(readFileSync(new URL('./docs-index.json', import.meta.url), 'utf8'));
  } catch {
    throw new DocsSearchError('The docs index is missing. Run `npm run build-docs-index` in apps/mcp.');
  }
  const docs = sections.map((section) => {
    const terms = tokens(`${section.title} ${section.title} ${section.heading} ${section.heading} ${section.text}`);
    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    return { section, counts, length: terms.length };
  });
  const frequency = new Map();
  for (const { counts } of docs) for (const term of counts.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const average = docs.reduce((sum, d) => sum + d.length, 0) / (docs.length || 1);
  loaded = { docs, frequency, average };
  return loaded;
}

const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'proxi', 'the', 'to', 'what', 'when', 'with', 'you', 'your']);

// Lowercase words, with a simple plural and "-ing/-ed" trim so "chats" finds "chat".
export function tokens(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !STOP.has(word))
    .map((word) => word.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, (m) => (word.length - m.length >= 3 ? '' : m)));
}

export function urlOf(page) {
  const site = (process.env.MINTLIFY_DOCS_URL?.trim() || DOCS_SITE).replace(/\/+$/, '');
  return page === 'index' ? `${site}/` : `${site}/${page}`;
}

export async function searchDocs(query, { limit = 5 } = {}) {
  const { docs, frequency, average } = load();
  const words = [...new Set(tokens(query))];
  if (!words.length) return [];
  const scored = [];
  for (const doc of docs) {
    let score = 0;
    for (const word of words) {
      const count = doc.counts.get(word);
      if (!count) continue;
      const idf = Math.log(1 + (docs.length - frequency.get(word) + 0.5) / (frequency.get(word) + 0.5));
      score += idf * ((count * (K1 + 1)) / (count + K1 * (1 - B + (B * doc.length) / average)));
    }
    // The changelog repeats every feature's name, so it ranks below the pages that explain them.
    if (doc.section.page === 'release-notes') score *= 0.5;
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ doc: { section }, score }) => {
    const text = `${section.heading ? `${section.heading}\n\n` : ''}${section.text}`;
    return {
      title: section.heading && section.heading !== section.title ? `${section.title}: ${section.heading}` : section.title,
      url: urlOf(section.page),
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text,
      score: Math.round(score * 100) / 100,
    };
  });
}
