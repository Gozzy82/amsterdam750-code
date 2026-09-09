import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';

function b64uToBytes(s) {
  const base64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class DefaultAzureCredential {}
}));

vi.mock('@azure/keyvault-keys', () => ({
  KeyClient: class KeyClient {
    async getKey() {
      return {
        id: 'https://example.vault.azure.net/keys/test-key/version-1',
        properties: { version: 'version-1' },
        keyOps: ['encrypt'],
        key: {
          ...publicJwk,
          // Regression case: Azure SDK may return RSA JWK parameters as bytes
          // while Node createPublicKey({ format: 'jwk' }) expects base64url strings.
          n: b64uToBytes(publicJwk.n),
          e: b64uToBytes(publicJwk.e),
        }
      };
    }
  },
  CryptographyClient: class CryptographyClient {}
}));

const { encryptPiiString } = await import('./index.keyvault.pii.js');

describe('encryptPiiString local JWK handling', () => {
  it('accepts key.n/key.e returned as Buffer and still encrypts locally', async () => {
    const envelope = await encryptPiiString({
      plaintext: 'sensitive-value',
      aad: 'USER_test',
      kvUrl: 'https://example.vault.azure.net',
      keyName: 'test-key',
      credential: {}
    });

    expect(envelope).toBeTruthy();
    expect(envelope.wk).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.wa).toBe('RSA-OAEP-256');
    expect(envelope.kid).toBe('https://example.vault.azure.net/keys/test-key/version-1');
  });
});
