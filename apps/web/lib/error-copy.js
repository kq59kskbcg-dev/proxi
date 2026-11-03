// The errors people see in a chat. The page shows each as a card: a title, one sentence and a
// "Try again" button, with a short reference for reporting a problem. Whose problem it is comes
// first, so nobody rewrites a message that was fine.
//
// The page imports this file too (ui/limits.js), so it must not import anything.
export const ERROR_COPY = {
  busy: { title: 'Proxi is busy right now', body: 'Too many requests at once. Try again in a minute.' },
  limit: { title: 'Too many messages', body: "You've sent a lot of messages in a short time. Wait a few minutes, then try again." },
  session: { title: 'Your session expired', body: 'Try again to sign back in. If it keeps happening, reload the page.' },
  error: { title: 'Something went wrong on our side', body: 'Your message is fine. Try again.' },
};
