import { requireUser } from './auth.js';

// A JSON response. API responses hold per-user data, so none of them are cached.
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// Wraps a route handler so it only runs for a signed-in user: handler(request, user).
// Without a valid session the response is { error, code } with the status from requireUser.
export function withUser(handler) {
  return async (request) => {
    const user = await requireUser(request);
    if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
    return handler(request, user);
  };
}
