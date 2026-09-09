import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeEmail, normalizePhone, isGuid, nowIso, generateMemorableCode, formatCode } from './index.js';

// =============================================================================

describe('normalizeEmail', () => {
  it('lowercases the email address', () => {
    expect(normalizeEmail('User@Example.COM')).toBe(normalizeEmail('user@example.com'));
  });

  it('preserves a normalized non-Gmail address', () => {
    expect(normalizeEmail('hello@example.com')).toBe('hello@example.com');
  });

  it('normalizes Gmail dot-insensitivity (strips dots in local part)', () => {
    // normalize-email strips dots from Gmail addresses
    const a = normalizeEmail('user.name@gmail.com');
    const b = normalizeEmail('username@gmail.com');
    expect(a).toBe(b);
  });

  it('preserves non-Gmail dots in the local part', () => {
    // For non-Gmail domains, dots in the local part are significant
    expect(normalizeEmail('first.last@example.com')).toBe('first.last@example.com');
  });

  it('strips Gmail plus-addressing (sub-addressing)', () => {
    const base = normalizeEmail('user@gmail.com');
    const tagged = normalizeEmail('user+newsletter@gmail.com');
    expect(tagged).toBe(base);
  });
});

// =============================================================================

describe('normalizePhone', () => {
  it('returns a valid E.164 number for a Dutch mobile number', () => {
    const result = normalizePhone('+31612345678');
    expect(result).toBe('+31612345678');
  });

  it('returns null for a Dutch local format without a country hint', () => {
    expect(normalizePhone('0612345678')).toBeNull();
  });

  it('returns null for an obviously invalid number', () => {
    expect(normalizePhone('not-a-number')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('accepts international format for a US number', () => {
    const result = normalizePhone('+12025551234');
    expect(result).toBe('+12025551234');
  });
});

// =============================================================================

describe('isGuid', () => {
  it('returns true for a valid UUID v4', () => {
    expect(isGuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  it('returns true for uppercase GUID format', () => {
    expect(isGuid('123E4567-E89B-42D3-A456-426614174000')).toBe(true);
  });

  it('returns false for malformed value', () => {
    expect(isGuid('not-a-guid')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isGuid('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isGuid(null)).toBe(false);
    expect(isGuid(123)).toBe(false);
    expect(isGuid({})).toBe(false);
  });
});

// =============================================================================

describe('nowIso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an ISO 8601 timestamp string', () => {
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
    const result = nowIso();
    expect(result).toBe('2024-06-15T10:30:00.000Z');
  });

  it('reflects the current time', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    vi.setSystemTime(now);
    expect(nowIso()).toBe(now.toISOString());
  });

});

// =============================================================================

describe('generateMemorableCode', () => {
  it('returns a zero-padded six-digit code', () => {
    for (let i = 0; i < 25; i += 1) {
      expect(generateMemorableCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('formatCode', () => {
  it('formats a six-digit code into pairs', () => {
    expect(formatCode('123456')).toBe('12-34-56');
  });
});
