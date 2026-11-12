// Where the chat list scrolls to. A message you send is pinned to the top of the list and the reply
// fills the space below it, so nothing moves while the reply is written. A spacer under the latest
// exchange makes room for that, and a down arrow shows when the reply runs past the bottom.
// All positions are in pixels from the top of the list's scrollable content.

// Where the list scrolls to so the pinned message sits at the same distance from the top as
// the list's own padding.
export function pinTarget({ pinnedTop, padTop }) {
  return Math.max(0, Math.round(pinnedTop - padTop));
}

// The empty space under the content that lets the list scroll to that target. It shrinks as the
// reply grows, and is 0 once the reply fills the screen.
export function spacerHeight({ clientHeight, padTop, padBottom, pinnedTop, contentEnd }) {
  const target = pinTarget({ pinnedTop, padTop });
  return Math.max(0, Math.ceil(target + clientHeight - contentEnd - padBottom));
}

// Whether the content continues below the visible part of the list.
export function hasMoreBelow({ scrollTop, clientHeight, contentEnd, slack = 8 }) {
  return contentEnd > scrollTop + clientHeight + slack;
}

// Where the list scrolls to so the end of the content is at the bottom.
export function endTarget({ contentEnd, padBottom, clientHeight }) {
  return Math.max(0, Math.round(contentEnd + padBottom - clientHeight));
}
