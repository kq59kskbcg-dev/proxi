// Replies are Markdown; sanitize the HTML so a reply can never inject scripts.
// Uses the marked and DOMPurify scripts the page loads before the modules.

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});
export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }), { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] });
}
