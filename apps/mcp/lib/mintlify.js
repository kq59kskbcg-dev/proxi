const API_URL = 'https://api.mintlify.com/discovery/v1';
const DOMAIN = 'proxi.mintlify.site';
const SHORT_SNIPPET = 200;
const MAX_TEXT = 4000;
const TIMEOUT_MS = 8000;

export class DocsSearchError extends Error {}

export async function searchDocs(query, { limit = 5 } = {}) {
  const key = process.env.MINTLIFY_API_KEY?.trim();
  if (!key) throw new DocsSearchError('Docs search is not set up (MINTLIFY_API_KEY is missing).');
  const body = { query, pageSize: limit };
  const threshold = Number(process.env.MINTLIFY_SCORE_THRESHOLD);
  if (threshold > 0) body.scoreThreshold = threshold;

  const raw = await call(key, 'search', body);
  const list = Array.isArray(raw) ? raw : raw?.results ?? raw?.data ?? [];
  const seen = new Set();
  const hits = [];
  for (const item of list) {
    if (typeof item?.path !== 'string' || typeof item.content !== 'string') continue;
    const id = `${item.path}\n${item.content}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push(item);
    if (hits.length >= limit) break;
  }

  return Promise.all(hits.map(async (item) => {
    let text = item.content;
    if (text.length < SHORT_SNIPPET) {
      const page = await call(key, 'page', { path: item.path }).catch(() => null);
      if (typeof page?.content === 'string' && page.content.length > text.length) text = page.content;
    }
    return {
      title: titleOf(item),
      url: urlOf(item.path),
      text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '...' : text,
      ...(typeof item.metadata?.score === 'number' ? { score: item.metadata.score } : {}),
    };
  }));
}

async function call(key, endpoint, body) {
  const base = process.env.MINTLIFY_API_URL?.trim() || API_URL;
  const domain = process.env.MINTLIFY_DOMAIN?.trim() || DOMAIN;
  const response = await fetch(`${base}/${endpoint}/${encodeURIComponent(domain)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    console.warn(`Mintlify ${endpoint} failed: HTTP ${response.status} for domain "${domain}"`, (await response.text().catch(() => '')).slice(0, 300));
    throw new DocsSearchError(`Docs search failed (HTTP ${response.status}).`);
  }
  return response.json();
}

function titleOf(item) {
  const meta = item.metadata ?? {};
  const title = [meta.title, meta.pageTitle, meta.name].find((v) => typeof v === 'string' && v.trim());
  return title?.trim() || item.path.replace(/^\/+/, '') || 'Proxi docs';
}

export function urlOf(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const site = (process.env.MINTLIFY_DOCS_URL?.trim() || `https://${DOMAIN}`).replace(/\/+$/, '');
  return `${site}/${path.replace(/^\/+/, '')}`;
}
