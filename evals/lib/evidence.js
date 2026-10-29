// Turns one chat run into what the judges need: the reply, the tools called, and the docs found.

// "https://proxi.mintlify.site/privacy" -> "privacy"; the site root is the "index" page.
export function pageOf(url) {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, '') || 'index';
  } catch {
    return String(url ?? '');
  }
}

// events: the chat route's streamed events. toolLog: every tool call and its result.
export function collectEvidence(events, toolLog) {
  const output = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  const retrieved = [];
  for (const call of toolLog) {
    if (call.name !== 'search_docs') continue;
    for (const block of Array.isArray(call.result?.content) ? call.result.content : []) {
      if (block.type !== 'search_result') continue;
      const text = (block.content ?? []).map((part) => part.text ?? '').join('\n');
      retrieved.push({ page: pageOf(block.source), title: block.title, text });
    }
  }
  return {
    output,
    toolCalls: toolLog.map((call) => ({ name: call.name, input: call.input })),
    retrieved,
    context: retrieved.map((doc) => `[${doc.page}] ${doc.text}`).join('\n\n'),
    error: events.find((e) => e.type === 'error')?.error ?? null,
  };
}

// The expected page must be among the first three distinct pages that search_docs returned.
export function pageRetrieved(evidence, page) {
  const pages = [...new Set(evidence.retrieved.map((doc) => doc.page))].slice(0, 3);
  return pages.includes(page);
}
