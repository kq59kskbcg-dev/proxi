import Anthropic from '@anthropic-ai/sdk';

// Web search through Claude: a separate Claude request with Anthropic's web
// search tool turned on. It returns a short answer and the pages it cited, so
// the chat model (any model) gets sources it can cite in turn.

const SEARCH_MODEL = 'claude-sonnet-5-5';
const MAX_SEARCHES = 3;
const MAX_PASSAGE = 1500;

const PROMPT = `You research the web for another assistant.
Search for what is asked, then write a short, factual answer that cites its sources.
If you can't find reliable information, say so plainly instead of guessing.`;

export class WebSearchError extends Error {}

let client;

export function webSearchConfigured() {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export async function searchWeb(query) {
  if (!webSearchConfigured()) throw new WebSearchError('Web search is not set up (ANTHROPIC_API_KEY is missing).');
  client ??= new Anthropic();
  const messages = [{ role: 'user', content: query }];
  let res;
  // A long search can pause; sending the turn back lets the server continue it.
  for (let round = 0; round < 3; round++) {
    res = await client.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }],
      messages,
    }, { timeout: 45_000, maxRetries: 1 });
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  if (res.stop_reason === 'refusal') throw new WebSearchError("The web search couldn't be done for this request.");
  return toResults(res.content);
}

// The answer text, and one source per cited page with the passages quoted from it.
export function toResults(content) {
  const answer = content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const sources = new Map();
  const add = (url, title, passage) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return;
    const source = sources.get(url) ?? { url, title: title || url, passages: [] };
    if (passage && !source.passages.includes(passage)) source.passages.push(passage);
    sources.set(url, source);
  };
  for (const block of content) {
    if (block.type === 'text') {
      for (const c of block.citations ?? []) if (c.type === 'web_search_result_location') add(c.url, c.title, c.cited_text);
    }
  }
  // Nothing cited: fall back to the pages the search found.
  if (!sources.size) {
    for (const block of content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === 'web_search_result') add(r.url, r.title);
      }
    }
  }
  return {
    answer,
    sources: [...sources.values()].map((s) => ({
      title: s.title,
      url: s.url,
      text: (s.passages.join('\n\n') || s.title).slice(0, MAX_PASSAGE),
    })),
  };
}
