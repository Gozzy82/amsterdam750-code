import { describe, it, expect, vi, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => ({
  appHttp: vi.fn(),
}));

vi.mock('@azure/functions', () => ({
  app: { http: mocks.appHttp },
}));

let handler;

beforeAll(async () => {
  await import('./index.js');
  handler = mocks.appHttp.mock.calls[0][1].handler;
});

// =============================================================================

describe('status handler', () => {
  it('returns 200', async () => {
    const res = await handler();
    expect(res.status).toBe(200);
  });

  it('returns the expected body', async () => {
    const res = await handler();
    expect(res.body).toBe('Hello World');
  });
});
