import { verifyToken } from '@clerk/backend';

// Verifies the Clerk session token sent as "Authorization: Bearer <token>".
// Fails closed: without Clerk configured, nobody gets in.
export async function requireUser(request) {
  // Trimmed: a key pasted with a trailing space or line break would fail every check.
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() || undefined;
  const jwtKey = process.env.CLERK_JWT_KEY?.trim() || undefined; // optional: verifies without a network call
  if (!secretKey && !jwtKey) return { error: 'Sign-in is not set up yet.', status: 503 };

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Please sign in.', status: 401, reason: 'no-token' };

  try {
    const payload = await verifyToken(token, { secretKey, jwtKey, authorizedParties: authorizedParties(request) });
    return { userId: payload.sub };
  } catch (error) {
    // Clerk's reason (e.g. token-expired, token-invalid-authorized-parties) says why, without revealing anything secret.
    const reason = typeof error?.reason === 'string' && /^[a-z-]{1,60}$/.test(error.reason) ? error.reason : 'token-rejected';
    return { error: 'Your session has expired. Please sign in again.', status: 401, reason };
  }
}

// Only accept tokens issued to this site, not to another app on the same Clerk instance.
function authorizedParties(request) {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured;
  // The address the browser used, as received or as forwarded by the host's proxy.
  const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')]
    .flatMap((h) => (h || '').split(',')).map((h) => h.trim()).filter(Boolean);
  return [...new Set(hosts)].map((h) => `https://${h}`);
}
