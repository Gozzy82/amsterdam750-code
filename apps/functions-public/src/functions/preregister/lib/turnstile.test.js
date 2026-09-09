import { describe, it, expect, vi, beforeEach } from 'vitest';
import { challengeHtmlInvisible, verifyTurnstile } from './turnstile.js';

// =============================================================================

describe('challengeHtmlInvisible', () => {
  it('embeds the sitekey in the output', () => {
    const html = challengeHtmlInvisible('test-site-key-abc');
    expect(html).toContain('test-site-key-abc');
  });

  it('targets #turnstile-notice with hx-swap-oob for out-of-band htmx swap', () => {
    const html = challengeHtmlInvisible('sk');
    expect(html).toContain('id="turnstile-notice"');
    expect(html).toContain('hx-swap-oob');
  });

  it('stores the Turnstile sitekey on the widget container', () => {
    const html = challengeHtmlInvisible('sk');
    expect(html).toContain('data-turnstile-sitekey="sk"');
  });

  it('renders the widget container element', () => {
    const html = challengeHtmlInvisible('sk');
    expect(html).toContain('id="widget-container"');
  });

  it('does not rely on inline script tags', () => {
    const html = challengeHtmlInvisible('sk');
    expect(html).not.toContain('<script');
  });

  it('handles an empty sitekey without throwing', () => {
    expect(() => challengeHtmlInvisible('')).not.toThrow();
  });
});

// =============================================================================

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when Cloudflare responds with success: true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    }));

    const result = await verifyTurnstile('valid-token', 'my-secret');
    expect(result).toBe(true);
  });

  it('returns false when Cloudflare responds with success: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }));

    const result = await verifyTurnstile('bad-token', 'my-secret');
    expect(result).toBe(false);
  });

  it('returns false when the fetch call throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await verifyTurnstile('token', 'secret');
    expect(result).toBe(false);
  });

  it('returns false when token is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstile('', 'secret');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when secret is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstile('token', '');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when both token and secret are empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyTurnstile('', '');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the Cloudflare siteverify endpoint with the correct parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await verifyTurnstile('my-token', 'my-secret');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      })
    );

    const body = fetchMock.mock.calls[0][1].body;
    expect(body.get('secret')).toBe('my-secret');
    expect(body.get('response')).toBe('my-token');
  });
});
