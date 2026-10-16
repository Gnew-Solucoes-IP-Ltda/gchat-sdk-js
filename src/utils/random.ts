/**
 * 32 random bytes encoded as base64url without padding (43 characters),
 * the same format the Gchat widget uses for operationId and visitProof.
 */
export function randomToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
