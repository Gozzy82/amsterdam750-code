import { describe, it, expect, vi } from 'vitest';
import { sha256Hex, envelopeToString, envelopeFromString } from './index.keyvault.pii.js';

// Note: getKvCryptoClient, makeDeterministicToken, encryptPiiString, and decryptPiiString
// all require a live Azure Key Vault connection and are therefore not covered by unit tests.

// =============================================================================

describe('sha256Hex', () => {
  it('returns a 64-character lowercase hex string', () => {
    const result = sha256Hex('hello');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a known hash for a fixed input', () => {
    // sha256('hello') is well-known
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hex('abc')).not.toBe(sha256Hex('xyz'));
  });

  it('is deterministic: same input → same output', () => {
    expect(sha256Hex('test-value')).toBe(sha256Hex('test-value'));
  });

  it('coerces non-string input to string', () => {
    // sha256Hex uses String(input) internally
    expect(() => sha256Hex(12345)).not.toThrow();
    expect(sha256Hex(12345)).toBe(sha256Hex('12345'));
  });
});

// =============================================================================

describe('envelopeToString / envelopeFromString', () => {
  const sampleEnvelope = {
    v: 1,
    enc: 'A256GCM',
    iv: 'aGVsbG8',
    ct: 'd29ybGQ',
    tag: 'dGVzdA',
    aad: '',
    wk: 'a2V5',
    wa: 'RSA-OAEP-256',
    kid: 'https://example.vault.azure.net/keys/my-key/abc123',
  };

  it('envelopeToString serialises an envelope to a non-empty base64url string', () => {
    const result = envelopeToString(sampleEnvelope);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // base64url: no +, /, or = characters
    expect(result).not.toMatch(/[+/=]/);
  });

  it('envelopeFromString round-trips back to the original object', () => {
    const encoded = envelopeToString(sampleEnvelope);
    const decoded = envelopeFromString(encoded);
    expect(decoded).toEqual(sampleEnvelope);
  });

  it('envelopeToString returns an empty string for null', () => {
    expect(envelopeToString(null)).toBe('');
  });

  it('envelopeToString returns an empty string for undefined', () => {
    expect(envelopeToString(undefined)).toBe('');
  });

  it('envelopeFromString returns null for an empty string', () => {
    expect(envelopeFromString('')).toBeNull();
  });

  it('envelopeFromString returns null for null input', () => {
    expect(envelopeFromString(null)).toBeNull();
  });

  it('envelopeFromString returns null for undefined input', () => {
    expect(envelopeFromString(undefined)).toBeNull();
  });

  it('round-trips an envelope containing unicode characters in the aad field', () => {
    const unicodeEnvelope = { ...sampleEnvelope, aad: 'USER_🎉_abc123' };
    const encoded = envelopeToString(unicodeEnvelope);
    const decoded = envelopeFromString(encoded);
    expect(decoded.aad).toBe('USER_🎉_abc123');
  });
});
