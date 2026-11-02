// One small client for Proxi's /api/* endpoints: Clerk auth headers, JSON bodies and replies,
// and the error card a failed chat request turns into.

import { CHAT_TOO_LARGE, OWN_CARDS } from './limits.js';

// A reply that wasn't ok. `data` is its JSON body, or {} when it had none.
export class ApiError extends Error {
  constructor(status, data) {
    super('api ' + status);
    this.status = status;
    this.data = data || {};
  }
}

async function readJson(res) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null;
  }
}

// What to show for a chat request the server didn't answer with a stream: its own card or
// message when it sent one, otherwise a card with the status as its reference.
export async function readProblem(res) {
  let problem = res.status === 413 ? { text: CHAT_TOO_LARGE } : { card: { ...OWN_CARDS.error, ref: String(res.status) } };
  try {
    const data = await res.json();
    if (data.card) problem = { card: data.card };
    else if (data.error) problem = { text: data.error };
  } catch (e) {}
  return problem;
}

// getToken returns the signed-in user's session token. Network errors are thrown as they come,
// so callers can tell them apart from an ApiError.
export function createApi({ getToken = () => window.Clerk.session.getToken(), fetch = (...args) => globalThis.fetch(...args) } = {}) {
  async function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await getToken()) };
  }

  // auth: false sends no headers (public endpoints). raw: true returns the Response as it is,
  // without checking its status or reading its body. query values are URL-encoded.
  async function request(method, path, { body, query, auth = true, raw = false, signal } = {}) {
    let url = path;
    if (query) url += '?' + Object.entries(query).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const init = {};
    if (method !== 'GET') init.method = method;
    if (auth) init.headers = await authHeaders();
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (signal) init.signal = signal;
    const res = await fetch(url, init);
    if (raw) return res;
    const data = await readJson(res);
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts)
  };
}

export const api = createApi();
