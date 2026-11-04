// Citations: the numbered source markers added after cited text blocks, and the "Sources"
// list at the end of a reply. Sources are numbered in the order they are first cited.

// Adds the citation's source to `sources` (once per URL) and returns its number, or 0 when the
// citation has no web URL.
export function sourceNumber(sources, citation) {
  const url = typeof citation?.source === 'string' ? citation.source : '';
  if (!/^https?:\/\//i.test(url)) return 0;
  const safe = url.replace(/[()\s]/g, encodeURIComponent);
  let index = sources.findIndex((s) => s.url === safe);
  if (index === -1) index = sources.push({ url: safe, title: citation.title || url }) - 1;
  return index + 1;
}

export function escapeLinkText(text) {
  return String(text).replace(/[[\]\\]/g, '\\$&');
}

// The marker for the sources a block cites, e.g. "[[1]](https://…)[[2]](https://…)".
export function citationMarker(sources, numbers) {
  return [...numbers].map((n) => `[[${n}]](${sources[n - 1].url})`).join('');
}

// The "Sources" list added at the end of a reply, or '' when nothing was cited.
export function sourcesList(sources) {
  if (!sources.length) return '';
  return '\n\n**Sources**\n' + sources.map((s, i) => `${i + 1}. [${escapeLinkText(s.title)}](${s.url})`).join('\n');
}

// Tracks the citations of one model response, block by block. `cite` records a citation in the
// current block; `endBlock` returns the marker to add after it, or '' for none. A block citing
// the same sources as the one before it gets no marker of its own, so a list drawn from one page
// shows its pill once. A block with text but no citations resets this.
export function blockCitations(sources) {
  let cited = new Set();
  let lastCited = '';
  return {
    cite(citation) {
      const n = sourceNumber(sources, citation);
      if (n) cited.add(n);
    },
    endBlock(wrote) {
      if (cited.size) {
        const marker = citationMarker(sources, cited);
        const shown = marker !== lastCited ? marker : '';
        lastCited = marker;
        cited = new Set();
        return shown;
      }
      if (wrote) lastCited = '';
      return '';
    },
  };
}

// A saved reply without the citation markers and "Sources" list added above, for sending it back
// as chat history. Left in, the model copies the format and writes a list of its own, so the
// reply shows two.
export function stripCitations(text) {
  return String(text)
    .replace(/\n\n\*\*Sources\*\*\n(?:\d+\. \[.*\]\(\S+\)(?:\n|$))+\s*$/, '')
    .replace(/ ?(?:\[\[\d+\]\]\(\S+?\))+/g, '');
}
