import { generateKeyPairSync, createSign } from 'node:crypto';

// Sets CLERK_JWT_KEY to a fresh key and returns a function that signs session tokens with it,
// the way Clerk would. Tokens are issued to https://localhost unless claims say otherwise.
export function useTestSignIn() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  return (claims) => signJwt(keys.privateKey, { azp: 'https://localhost', ...claims });
}

export function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}
