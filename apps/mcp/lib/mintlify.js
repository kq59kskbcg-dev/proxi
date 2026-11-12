// Help center search without an API key. The docs site is public, and Mintlify publishes every
// page of it as one plain text file at /llms-full.txt. This downloads that file, keeps it for an
// hour, splits it into sections and ranks them against the question with BM25 (word matching
// that favors rare words). Each result is the best section of a page, with the page's title and link.

const DOCS_URL = 'https://proxi.mintlify.site';
const CACHE_MS = 60 * 60 * 1000;
const SHORT_SNIPPET = 200;
const MAX_TEXT = 4000;
const TIMEOUT_MS = 8000;
const K1 = 1.2;
const B = 0.75;
// A word in the page title counts like this many words in the text, and a heading like half of it.
const TITLE_WEIGHT = 3;
const HEADING_WEIGHT = 2;

export class DocsSearchError extends Error {}

let cache = null; // { at, sections }
let loading = null;

export function resetDocsCache() {
  cache = null;
  loading = null;
}

export async function searchDocs(query, { limit = 5 } = {}) {
  const sections = await loadSections();
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  return rank(sections, terms).slice(0, limit).map(({ section }) => ({
    title: section.page.title,
    url: section.page.url,
    text: textOf(section),
  }));
}

// The best section of each page, best page first. Pages with no matching word are left out.
function rank(sections, terms) {
  const n = sections.length;
  const avg = sections.reduce((sum, s) => sum + s.length, 0) / (n || 1);
  const idf = new Map(terms.map((term) => {
    const df = sections.reduce((count, s) => count + (s.counts.has(term) ? 1 : 0), 0);
    return [term, Math.log(1 + (n - df + 0.5) / (df + 0.5))];
  }));
  const best = new Map();
  for (const section of sections) {
    let score = 0;
    for (const term of terms) {
      const tf = section.counts.get(term) ?? 0;
      if (tf) score += idf.get(term) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (section.length / avg))));
    }
    if (score > 0 && score > (best.get(section.page)?.score ?? 0)) best.set(section.page, { section, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// A section that is only a line or two gets the start of its page, so the result reads on its own.
function textOf(section) {
  const text = section.text.length < SHORT_SNIPPET ? section.page.body : section.text;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '...' : text;
}

async function loadSections() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.sections;
  loading ??= download().then((sections) => { cache = { at: Date.now(), sections }; return sections; })
    .finally(() => { loading = null; });
  try {
    return await loading;
  } catch (error) {
    // A page that is down for a moment shouldn't take search with it: use the last copy.
    if (cache) return cache.sections;
    throw error;
  }
}

async function download() {
  const site = (process.env.MINTLIFY_DOCS_URL?.trim() || DOCS_URL).replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${site}/llms-full.txt`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.warn('Docs download failed:', error?.name);
    throw new DocsSearchError('Docs search is unavailable right now.');
  }
  if (!response.ok) {
    console.warn(`Docs download failed: HTTP ${response.status} for ${site}/llms-full.txt`);
    throw new DocsSearchError(`Docs search failed (HTTP ${response.status}).`);
  }
  const pages = parsePages(await response.text());
  if (!pages.length) {
    console.warn('Docs download had no pages in the expected format');
    throw new DocsSearchError('Docs search is unavailable right now.');
  }
  return pages.flatMap(sectionsOf);
}

// Pages in llms-full.txt look like "# Title", then "Source: https://site/page", then the text.
// Returns [{ title, url, body }].
export function parsePages(text) {
  const lines = String(text).split(/\r?\n/);
  const starts = [];
  lines.forEach((line, i) => {
    const source = /^Source:\s*(https?:\/\/\S+)\s*$/.exec(line);
    if (!source) return;
    // The title is the heading just above the Source line (a description may sit between them).
    let at = -1;
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      if (/^#\s+\S/.test(lines[k])) { at = k; break; }
    }
    starts.push({ line: at === -1 ? i : at, source: i, url: source[1], title: at === -1 ? '' : lines[at].replace(/^#\s+/, '').trim() });
  });
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].line : lines.length;
    const body = lines.slice(start.source + 1, end).join('\n').trim();
    return { title: start.title || start.url.replace(/^https?:\/\/[^/]+\/?/, '') || 'Proxi docs', url: start.url, body };
  }).filter((page) => page.body);
}

// A page cut at its "##" and "###" headings. The part before the first heading is its own section.
function sectionsOf(page) {
  const parts = page.body.split(/^(?=#{2,3}\s)/m).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => {
    const heading = /^#{2,3}\s+(.+)/.exec(part)?.[1] ?? '';
    const words = [
      ...Array(TITLE_WEIGHT).fill(page.title).flatMap(tokens),
      ...Array(HEADING_WEIGHT).fill(heading).flatMap(tokens),
      ...tokens(part),
    ];
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    return { page, text: part, counts, length: words.length };
  });
}

const STOPWORDS = new Set(('a an and are as at be by can do does did for from has have how i if in is it its me my of on or our '
  + 'so than that the their then there these they this to was we were what when where which who why will with you your').split(' '));

// Lowercase words, without common filler words and with the most common endings cut off, so
// "encrypted" and "encryption" both become "encrypt".
export function tokens(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !STOPWORDS.has(word))
    .map(stem);
}

function stem(word) {
  if (word.length <= 4) return word;
  for (const suffix of ['ations', 'ation', 'ions', 'ion', 'ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}
