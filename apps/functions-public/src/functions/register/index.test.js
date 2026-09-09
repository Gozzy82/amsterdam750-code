import { describe, it, expect, vi, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => ({
  appHttp: vi.fn(),
  fromConnectionString: vi.fn(),
  tableState: {
    preregEntities: [],
  },
}));

vi.mock('@azure/functions', () => ({
  app: { http: mocks.appHttp },
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

let handler;

function asAsyncIterable(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

beforeAll(async () => {
  mocks.fromConnectionString.mockImplementation((_conn, tableName) => {
    if (tableName === (process.env.OTP_TABLE_NAME || 'OtpCodes')) {
      return {
        createTable: vi.fn().mockResolvedValue(undefined),
        getEntity: vi.fn().mockResolvedValue({
          createdAt: new Date().toISOString(),
          attempts: 0,
          code: '123456',
          maskedPhone: '+316****678',
          smsSentCount: 0,
          lastSmsSentAt: new Date().toISOString(),
        }),
        deleteEntity: vi.fn().mockResolvedValue(undefined),
        updateEntity: vi.fn().mockResolvedValue(undefined),
        upsertEntity: vi.fn().mockResolvedValue(undefined),
      };
    }

    return {
      listEntities: vi.fn(() => asAsyncIterable(mocks.tableState.preregEntities)),
    };
  });

  await import('./index.js');
  handler = mocks.appHttp.mock.calls[0][1].handler;
}, 30000);

function makeReq(method = 'POST', origin = 'https://example.com', body = '', url = 'http://localhost:7071/api/register') {
  return {
    method,
    url,
    text: async () => body,
    headers: { get: (k) => (k === 'origin' ? origin : null) },
  };
}

const ctx = { log: vi.fn() };

// =============================================================================

describe('register handler', () => {
  it('returns 400 for POST requests without token', async () => {
    const res = await handler(makeReq('POST'), ctx);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Token ontbreekt');
  });

  it('returns 404 for POST requests with invalid token format', async () => {
    const res = await handler(makeReq('POST', 'https://example.com', 'token=invalid-token'));
    expect(res.status).toBe(404);
    expect(res.body).toContain('Uitnodiging niet gevonden of verlopen');
  });

  it('returns 500 for valid token when storage is not configured', async () => {
    const previousConnectionString = process.env.TABLE_CONNECTION_STRING;
    const previousSecret = process.env.TURNSTILE_SECRET;
    delete process.env.TABLE_CONNECTION_STRING;
    process.env.TURNSTILE_SECRET = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));

    try {
      const res = await handler(
        makeReq('POST', 'https://example.com', 'token=123e4567-e89b-42d3-a456-426614174000&cf-turnstile-response=valid'),
        ctx
      );
      expect(res.status).toBe(500);
      expect(res.body).toContain('Server niet geconfigureerd (storage)');
    } finally {
      if (previousConnectionString === undefined) delete process.env.TABLE_CONNECTION_STRING;
      else process.env.TABLE_CONNECTION_STRING = previousConnectionString;
      if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = previousSecret;
      vi.unstubAllGlobals();
    }
  });

  it('rejects an sms request without a Turnstile token', async () => {
    const previousSecret = process.env.TURNSTILE_SECRET;
    process.env.TURNSTILE_SECRET = 'test-secret';

    try {
      const res = await handler(
        makeReq('POST', 'https://example.com', 'token=123e4567-e89b-42d3-a456-426614174000&phone=%2B31612345678'),
        ctx
      );
      expect(res.status).toBe(400);
      expect(res.body).toContain('Verificatie ontbreekt');
    } finally {
      if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = previousSecret;
    }
  });

  it('rejects an sms request with an invalid Turnstile token', async () => {
    const previousSecret = process.env.TURNSTILE_SECRET;
    process.env.TURNSTILE_SECRET = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));

    try {
      const res = await handler(
        makeReq('POST', 'https://example.com', 'token=123e4567-e89b-42d3-a456-426614174000&phone=%2B31612345678&cf-turnstile-response=invalid'),
        ctx
      );
      expect(res.status).toBe(400);
      expect(res.body).toContain('Verificatie mislukt');
    } finally {
      if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = previousSecret;
      vi.unstubAllGlobals();
    }
  });

  it('returns HTML content type for POST', async () => {
    const res = await handler(makeReq('POST'), ctx);
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('returns 404 when token is valid but no preregistration user exists', async () => {
    const previousConn = process.env.TABLE_CONNECTION_STRING;
    const previousTableName = process.env.TABLE_NAME;
    const previousSecret = process.env.TURNSTILE_SECRET;

    process.env.TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    process.env.TABLE_NAME = 'PreRegistrations';
    process.env.TURNSTILE_SECRET = 'test-secret';
    mocks.tableState.preregEntities = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));

    try {
      const res = await handler(
        makeReq('POST', 'https://example.com', 'token=123e4567-e89b-42d3-a456-426614174000&phone=%2B31612345678&cf-turnstile-response=valid'),
        ctx
      );
      expect(res.status).toBe(404);
      expect(res.body).toContain('Uitnodiging niet gevonden of verlopen');
    } finally {
      if (previousConn === undefined) delete process.env.TABLE_CONNECTION_STRING;
      else process.env.TABLE_CONNECTION_STRING = previousConn;

      if (previousTableName === undefined) delete process.env.TABLE_NAME;
      else process.env.TABLE_NAME = previousTableName;

      if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = previousSecret;
      vi.unstubAllGlobals();
    }
  });
});
