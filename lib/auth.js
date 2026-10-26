import { verifyToken } from '@clerk/backend';

// Verifies the Clerk session token sent as "Authorization: Bearer <token>".
// Fails closed: without Clerk configured, nobody gets in.
export async function requireUser(request) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const jwtKey = process.env.CLERK_JWT_KEY; // optional: verifies without a network call
  if (!secretKey && !jwtKey) return { error: 'Sign-in is not set up yet.', status: 503 };

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Please sign in.', status: 401 };

  try {
    const payload = await verifyToken(token, { secretKey, jwtKey, authorizedParties: authorizedParties(request) });
    return { userId: payload.sub };
  } catch {
    return { error: 'Your session has expired. Please sign in again.', status: 401 };
  }
}

// Only accept tokens issued to this site, not to another app on the same Clerk instance.
function authorizedParties(request) {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured;
  const host = request.headers.get('host');
  return host ? [`https://${host}`] : [];
}
