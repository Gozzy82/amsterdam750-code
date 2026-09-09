import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCipheriv, randomBytes } from 'crypto';

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const decryptMock = vi.fn();
const cryptoClientCtorArgs = [];

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class DefaultAzureCredential {}
}));

vi.mock('@azure/keyvault-keys', () => ({
  KeyClient: class KeyClient {
    async getKey() {
      throw new Error('KeyClient.getKey should not be called when envelope.kid is present');
    }
  },
  CryptographyClient: class CryptographyClient {
    constructor(keyRef) {
      cryptoClientCtorArgs.push(keyRef);
    }

    async decrypt(alg, encryptedKey) {
      return decryptMock(alg, encryptedKey);
    }
  }
}));

const { decryptPiiString } = await import('./index.keyvault.pii.js');

describe('decryptPiiString key version handling', () => {
  beforeEach(() => {
    decryptMock.mockReset();
    cryptoClientCtorArgs.length = 0;
  });

  it('uses envelope.kid for unwrap/decrypt instead of resolving latest key version', async () => {
    const plaintext = 'sensitive-value';
    const aad = 'USER_test';
    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const wrappedDek = Buffer.from('wrapped-dek');

    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();

    decryptMock.mockResolvedValue({ result: dek });

    const envelope = {
      v: 1,
      enc: 'A256GCM',
      iv: b64u(iv),
      ct: b64u(ct),
      tag: b64u(tag),
      aad: b64u(Buffer.from(aad, 'utf8')),
      wk: b64u(wrappedDek),
      wa: 'RSA-OAEP-256',
      kid: 'https://example.vault.azure.net/keys/test-key/version-1'
    };

    const result = await decryptPiiString({
      envelope,
      aad,
      kvUrl: 'https://example.vault.azure.net',
      keyName: 'test-key',
      credential: {}
    });

    expect(result).toBe(plaintext);
    expect(cryptoClientCtorArgs).toEqual([envelope.kid]);
    expect(decryptMock).toHaveBeenCalledWith('RSA-OAEP-256', wrappedDek);
  });
});
