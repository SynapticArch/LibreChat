import { randomBytes } from 'crypto';

export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  userId: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const consentRequests = new Map<string, ConsentRequest>();

function cleanupExpired(now = Date.now()): void {
  for (const [nonce, request] of consentRequests.entries()) {
    if (request.expiresAt <= now) {
      consentRequests.delete(nonce);
    }
  }
}

export function createConsentRequest(input: Omit<ConsentRequest, 'expiresAt'>): string {
  cleanupExpired();
  const nonce = randomBytes(24).toString('base64url');
  consentRequests.set(nonce, {
    ...input,
    expiresAt: Date.now() + TTL_MS,
  });
  return nonce;
}

export function consumeConsentRequest(nonce: string): ConsentRequest | null {
  cleanupExpired();
  const request = consentRequests.get(nonce);
  if (!request) {
    return null;
  }
  consentRequests.delete(nonce);
  if (request.expiresAt <= Date.now()) {
    return null;
  }
  return request;
}

export function clearConsentRequests(): void {
  consentRequests.clear();
}
