// Suggested replies: the chips shown above the message box after a reply that ends with a
// short-answer question. They belong to that reply only while it's the chat's last message,
// and hide while a reply is on its way or something is typed or attached.

// suggestions: { convId, msgId, options } from the server's "suggestions" event, or null.
export function visibleSuggestions(suggestions, conv, { typing, draft, pending }) {
  if (!suggestions || !conv || suggestions.convId !== conv.id) return [];
  const last = conv.messages[conv.messages.length - 1];
  if (!last || last.id !== suggestions.msgId || last.error) return [];
  if (typing || (draft || '').trim() || (pending || []).length) return [];
  return suggestions.options;
}

// Whether a sideways-scrolling chip row has more chips past its right edge.
export function hasMoreToScroll({ scrollLeft, clientWidth, scrollWidth }) {
  return scrollLeft + clientWidth < scrollWidth - 1;
}
