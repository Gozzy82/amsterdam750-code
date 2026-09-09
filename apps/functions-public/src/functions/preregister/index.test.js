import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// --- Hoisted mock objects (must exist before vi.mock factory functions run) ---
const mocks = vi.hoisted(() => ({
  tableClient: {
    createTable: vi.fn(),
    createEntity: vi.fn(),
    getEntity: vi.fn(),
    upsertEntity: vi.fn(),
    updateEntity: vi.fn(),
    deleteEntity: vi.fn(),
    submitTransaction: vi.fn(),
  },
  appHttp: vi.fn(),
  appInsightsSetup: vi.fn(),
  appInsightsStart: vi.fn(),
  encryptPiiString: vi.fn(),
  envelopeToString: vi.fn(),
  sha256Hex: vi.fn(),
  normalizeEmail: vi.fn(),
  normalizePhone: vi.fn(),
}));

// --- Module mocks ---
vi.mock('@azure/functions', () => ({
  app: { http: mocks.appHttp },
}));

// AppInsights setup is a long fluent chain; mock the whole default export
vi.mock('applicationinsights', () => ({
  default: {
    setup: mocks.appInsightsSetup.mockImplementation(() => ({
      setAutoDependencyCorrelation: vi.fn(() => ({
        setAutoCollectRequests: vi.fn(() => ({
          setAutoCollectPerformance: vi.fn(() => ({
            setAutoCollectDependencies: vi.fn(() => ({
              setAutoCollectConsole: vi.fn(() => ({
                setUseDiskRetryCaching: vi.fn(() => ({
                  start: mocks.appInsightsStart,
                })),
              })),
            })),
          })),
        })),
      })),
    })),
    defaultClient: null,
  },
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: { fromConnectionString: vi.fn(() => mocks.tableClient) },
}));

vi.mock('@gozzy82/amsterdam750-shared', () => ({
  normalizeEmail: (e) => mocks.normalizeEmail(e),
  normalizePhone: (p) => mocks.normalizePhone(p),
}));

vi.mock('@gozzy82/amsterdam750-shared/keyvault', () => ({
  encryptPiiString: (opts) => mocks.encryptPiiString(opts),
  envelopeToString: (e) => mocks.envelopeToString(e),
  sha256Hex: (s) => mocks.sha256Hex(s),
}));

// --- Load handler via app.http registration ---
let handler;

beforeAll(async () => {
  await import('./index.js');
  handler = mocks.appHttp.mock.calls[0][1].handler;
});

// --- Test helpers ---
function makeReq({ method = 'POST', formData = {}, cookie = '' } = {}) {
  const headers = new Map([
    ['content-type', 'application/x-www-form-urlencoded'],
    ['cookie', cookie],
  ]);
  return {
    method,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    text: async () => new URLSearchParams(formData).toString(),
  };
}

const ctx = { log: vi.fn() };

const validForm = {
  firstName: 'Jan',
  lastName: 'de Vries',
  email: 'jan@example.com',
  phone: '0612345678',
  consent: '1',
  'cf-turnstile-response': 'valid-token',
};

// --- Default setup before each test ---
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  process.env.TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  process.env.TURNSTILE_SECRET = 'test-secret';
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.WEBSITE_INSTANCE_ID;
  delete process.env.KV_URL;
  delete process.env.KEK_KEY_NAME;

  mocks.normalizeEmail.mockImplementation(e => e.toLowerCase());
  mocks.normalizePhone.mockImplementation(p => p ? '+31612345678' : null);
  mocks.sha256Hex.mockImplementation(s => `hash_${s}`);
  mocks.encryptPiiString.mockResolvedValue({ v: 1, enc: 'A256GCM', iv: 'i', ct: 'c', tag: 't', aad: '', wk: 'w', wa: 'RSA-OAEP-256' });
  mocks.envelopeToString.mockReturnValue('enc-pii-blob');

  mocks.tableClient.createTable.mockResolvedValue(undefined);
  mocks.tableClient.createEntity.mockResolvedValue(undefined);
  mocks.tableClient.upsertEntity.mockResolvedValue(undefined);
  mocks.tableClient.updateEntity.mockResolvedValue(undefined);
  mocks.tableClient.deleteEntity.mockResolvedValue(undefined);
  mocks.tableClient.submitTransaction.mockResolvedValue(undefined);
  // Default: entity not found (used by checkLimit, incrCounter)
  mocks.tableClient.getEntity.mockRejectedValue({ statusCode: 404 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ success: true }),
  }));
});

// =============================================================================

describe('app insights bootstrap', () => {
  it('starts Application Insights during local development when a connection string is set', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    delete process.env.WEBSITE_INSTANCE_ID;

    vi.resetModules();
    await import('./index.js');

    expect(mocks.appInsightsSetup).toHaveBeenCalledWith('InstrumentationKey=test');
    expect(mocks.appInsightsStart).toHaveBeenCalledOnce();
  });

  it('does not start Application Insights on Azure even when a connection string is set', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    process.env.WEBSITE_INSTANCE_ID = 'azure-instance';

    vi.resetModules();
    await import('./index.js');

    expect(mocks.appInsightsSetup).not.toHaveBeenCalled();
    expect(mocks.appInsightsStart).not.toHaveBeenCalled();
  });
});

// =============================================================================

describe('input validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await handler(makeReq({
      formData: { firstName: 'Jan', 'cf-turnstile-response': 'valid-token' },
    }), ctx);
    expect(res.status).toBe(400);
    expect(res.body).toContain('verplichte velden');
  });

  it('returns 400 when phone normalizes to null (invalid number)', async () => {
    mocks.normalizePhone.mockReturnValue(null);
    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 when consent is missing', async () => {
    const { consent: _, ...noConsent } = validForm;
    const res = await handler(makeReq({ formData: noConsent }), ctx);
    expect(res.status).toBe(400);
  });

  it('silently rejects honeypot (company field) with a generic 200 error', async () => {
    const res = await handler(makeReq({ formData: { ...validForm, company: 'Acme' } }), ctx);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Er ging iets mis');
    // Must not reveal the honeypot rejection — no 400/403
  });

  it('returns 500 when TABLE_CONNECTION_STRING is not configured', async () => {
    delete process.env.TABLE_CONNECTION_STRING;
    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(500);
  });
});

// =============================================================================

describe('successful registration', () => {
  it('returns 200 with success message', async () => {
    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Bedankt');
  });

  it('still returns 200 when stats counter increment fails after persistence', async () => {
    mocks.tableClient.createEntity.mockImplementation(async (entity) => {
      if (entity?.rowKey === "counters") {
        throw { statusCode: 503, code: "ServerBusy", message: "stats temporarily unavailable" };
      }
      return undefined;
    });

    const res = await handler(makeReq({ formData: validForm }), ctx);

    expect(res.status).toBe(200);
    expect(res.body).toContain('Bedankt');
    expect(mocks.tableClient.submitTransaction).toHaveBeenCalledOnce();
    expect(ctx.log).toHaveBeenCalledWith(
      "preregister.statsIncrementFailed",
      expect.objectContaining({ statusCode: 503, code: "ServerBusy" }),
    );
  });

  it('does not set a cookie', async () => {
    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('does not read cookies for rate limiting', async () => {
    const res = await handler(makeReq({ formData: validForm, cookie: 'session=existing-abc123' }), ctx);
    expect(res.headers['Set-Cookie']).toBeUndefined();
    const rateLimitCalls = mocks.tableClient.getEntity.mock.calls
      .filter(([partitionKey]) => partitionKey.startsWith('rl-'));
    expect(rateLimitCalls).toEqual([['rl-em:hash_jan@example.com', expect.any(String)]]);
  });

  it('encrypts all PII fields in a single envelope call', async () => {
    await handler(makeReq({ formData: validForm }), ctx);

    expect(mocks.encryptPiiString).toHaveBeenCalledOnce();
    const { plaintext, aad } = mocks.encryptPiiString.mock.calls[0][0];
    const pii = JSON.parse(plaintext);
    expect(pii).toMatchObject({ firstName: 'Jan', lastName: 'de Vries' });
    expect(pii.email).toBe('jan@example.com');
    expect(pii.phone).toBe('+31612345678');
    // aad binds the ciphertext to the specific user row key
    expect(aad).toMatch(/^USER_/);
  });

  it('hashes email and phone for lock row keys — no plaintext PII in row keys', async () => {
    await handler(makeReq({ formData: validForm }), ctx);

    // sha256Hex must be called with the normalized values
    expect(mocks.sha256Hex).toHaveBeenCalledWith('jan@example.com');
    expect(mocks.sha256Hex).toHaveBeenCalledWith('+31612345678');

    // Phone lock uses a separate createEntity call (rowKey = hashed phone, not plaintext)
    const phoneLockEntity = mocks.tableClient.createEntity.mock.calls
      .map(([e]) => e)
      .find(e => String(e.partitionKey).startsWith('phone-'));
    expect(phoneLockEntity).toBeDefined();
    expect(phoneLockEntity.rowKey).toBe('hash_+31612345678');
    expect(phoneLockEntity.rowKey).not.toBe('+31612345678');

    // Email lock in the transaction uses the hashed rowKey, not the raw email directly
    const [tx] = mocks.tableClient.submitTransaction.mock.calls[0];
    const emailEntity = tx.find(([, e]) => e.kind === 'uniq-email')[1];
    expect(emailEntity.rowKey).toBe('EMAIL_hash_jan@example.com');
    expect(emailEntity.rowKey).not.toBe('EMAIL_jan@example.com');
  });

  it('submits an atomic transaction with 2 entities (email lock and user)', async () => {
    await handler(makeReq({ formData: validForm }), ctx);

    const [tx] = mocks.tableClient.submitTransaction.mock.calls[0];
    expect(tx).toHaveLength(2);
    expect(tx.map(([op]) => op)).toEqual(['create', 'create']);
    expect(tx.map(([, e]) => e.kind).sort()).toEqual(['uniq-email', 'user'].sort());
  });

  it('creates a separate phone lock entity before the transaction', async () => {
    await handler(makeReq({ formData: validForm }), ctx);

    const phoneLockCalls = mocks.tableClient.createEntity.mock.calls.filter(
      ([e]) => String(e.partitionKey).startsWith('phone-')
    );
    expect(phoneLockCalls).toHaveLength(1);
  });

  it('recreates a missing phone lock table and retries the reservation', async () => {
    mocks.tableClient.createEntity
      .mockRejectedValueOnce({ statusCode: 404, code: 'TableNotFound' })
      .mockResolvedValueOnce(undefined);

    const res = await handler(makeReq({ formData: validForm }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.tableClient.createTable).toHaveBeenCalledOnce();
    const phoneLockCreateCalls = mocks.tableClient.createEntity.mock.calls
      .map(([entity]) => entity)
      .filter((entity) => String(entity.partitionKey).startsWith("phone-"));
    expect(phoneLockCreateCalls).toHaveLength(2);
  });

  it('recreates a missing preregistration table and retries the transaction', async () => {
    mocks.tableClient.submitTransaction
      .mockRejectedValueOnce({ statusCode: 404, code: 'TableNotFound' })
      .mockResolvedValueOnce(undefined);

    const res = await handler(makeReq({ formData: validForm }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.tableClient.createTable).toHaveBeenCalledOnce();
    expect(mocks.tableClient.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it('user entity stores encrypted pii blob with no plaintext name/email/phone', async () => {
    await handler(makeReq({ formData: validForm }), ctx);

    const [tx] = mocks.tableClient.submitTransaction.mock.calls[0];
    const userEntity = tx.find(([, e]) => e.kind === 'user')[1];

    expect(userEntity.pii).toBe('enc-pii-blob');
    expect(userEntity.firstName).toBeUndefined();
    expect(userEntity.lastName).toBeUndefined();
    expect(userEntity.email).toBeUndefined();
    expect(userEntity.phone).toBeUndefined();
  });
});

// =============================================================================

describe('duplicate registration', () => {
  it('returns 409 when phone is already registered', async () => {
    mocks.tableClient.createEntity
      .mockRejectedValueOnce({ statusCode: 409 })
      .mockResolvedValue(undefined);

    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(409);
    expect(res.body).toContain('al eerder gebruikt');
  });

  it('returns 409 when email is already registered (transaction conflict)', async () => {
    // Phone lock succeeds but the email-lock+user transaction fails with 409
    mocks.tableClient.submitTransaction.mockRejectedValue({ statusCode: 409 });

    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(409);
    expect(res.body).toContain('al eerder gebruikt');
  });

  it('rolls back the phone lock when the email transaction returns 409', async () => {
    mocks.tableClient.submitTransaction.mockRejectedValue({ statusCode: 409 });

    await handler(makeReq({ formData: validForm }), ctx);

    const [{ partitionKey, rowKey }] = mocks.tableClient.createEntity.mock.calls
      .map(([e]) => e)
      .filter((entity) => String(entity.partitionKey).startsWith("phone-"));

    // deleteEntity should be called to release the reserved phone lock
    expect(mocks.tableClient.deleteEntity).toHaveBeenCalledWith(partitionKey, rowKey);
  });

  it('rolls back the phone lock when PII encryption fails', async () => {
    mocks.encryptPiiString.mockRejectedValue(new Error('key vault unavailable'));

    const res = await handler(makeReq({ formData: validForm }), ctx);

    expect(res.status).toBe(500);
    const [{ partitionKey, rowKey }] = mocks.tableClient.createEntity.mock.calls
      .map(([e]) => e)
      .filter((entity) => String(entity.partitionKey).startsWith("phone-"));
    expect(mocks.tableClient.deleteEntity).toHaveBeenCalledWith(partitionKey, rowKey);
    expect(mocks.tableClient.submitTransaction).not.toHaveBeenCalled();
  });

  it('rolls back the phone lock for unexpected transaction errors', async () => {
    mocks.tableClient.submitTransaction.mockRejectedValue({ statusCode: 503, message: 'service unavailable' });

    await handler(makeReq({ formData: validForm }), ctx);

    const [{ partitionKey, rowKey }] = mocks.tableClient.createEntity.mock.calls
      .map(([e]) => e)
      .filter((entity) => String(entity.partitionKey).startsWith("phone-"));
    expect(mocks.tableClient.deleteEntity).toHaveBeenCalledWith(partitionKey, rowKey);
  });

  it('logs a rollback error without hiding the original failure', async () => {
    mocks.encryptPiiString.mockRejectedValue(new Error('key vault unavailable'));
    mocks.tableClient.deleteEntity.mockRejectedValue({
      statusCode: 503,
      code: 'ServerBusy',
      message: 'storage unavailable',
    });

    const res = await handler(makeReq({ formData: validForm }), ctx);

    expect(res.status).toBe(500);
    expect(ctx.log).toHaveBeenCalledWith(
      "preregister.phoneLockRollbackFailed",
      expect.objectContaining({ statusCode: 503, code: "ServerBusy" }),
    );
    expect(ctx.log).toHaveBeenCalledWith("preregister.error", "key vault unavailable");
  });

  it('returns 500 for unexpected storage errors (non-409)', async () => {
    mocks.tableClient.submitTransaction.mockRejectedValue({ statusCode: 503, message: 'service unavailable' });

    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(500);
  });
});

// =============================================================================

// =============================================================================

describe('Turnstile verification', () => {
  it('returns 400 when cf-turnstile-response token is missing', async () => {
    const { 'cf-turnstile-response': _, ...formWithoutToken } = validForm;
    const res = await handler(makeReq({ formData: formWithoutToken }), ctx);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Verificatie ontbreekt');
  });

  it('returns 400 when Turnstile verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }));
    const res = await handler(makeReq({ formData: { ...validForm, 'cf-turnstile-response': 'bad-token' } }), ctx);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Verificatie mislukt');
  });

  it('increments challenge_failed counter when verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }));
    await handler(makeReq({ formData: { ...validForm, 'cf-turnstile-response': 'bad-token' } }), ctx);
    // incrCounter creates a new stats entity (via createEntity) when none exists (default 404 mock).
    const createCalls = mocks.tableClient.createEntity.mock.calls.map(([e]) => e);
    const statRow = createCalls.find(e => e.rowKey === 'counters');
    expect(statRow?.challenge_failed).toBe(1);
  });

  it('proceeds to registration when Turnstile verification passes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    }));
    const res = await handler(makeReq({ formData: { ...validForm, 'cf-turnstile-response': 'valid-token' } }), ctx);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Bedankt');
  });

  it('rejects the request when TURNSTILE_SECRET is not configured', async () => {
    delete process.env.TURNSTILE_SECRET;
    const res = await handler(makeReq({ formData: validForm }), ctx);
    expect(res.status).toBe(500);
    expect(res.body).toContain('Server niet geconfigureerd');
    expect(mocks.tableClient.submitTransaction).not.toHaveBeenCalled();
  });

  it('validates Turnstile before validating submission fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }));

    const res = await handler(makeReq({
      formData: { firstName: 'Jan', 'cf-turnstile-response': 'bad-token' },
    }), ctx);

    expect(res.status).toBe(400);
    expect(res.body).toContain('Verificatie mislukt');
    expect(res.body).not.toContain('verplichte velden');
  });
});

// =============================================================================

describe('rate limiting', () => {
  beforeEach(() => {
    // Simulate over-limit: count far exceeds RL_EMAIL_LIMIT (default 3).
    mocks.tableClient.getEntity.mockResolvedValue({ count: 9999 });
  });

  it('returns 429 when rate limited by hashed email', async () => {
    const res = await handler(makeReq({ formData: validForm }));
    expect(res.status).toBe(429);
    expect(res.body).toContain('te vaak op Versturen geklikt');
    expect(res.body).toMatch(/\d+ minuten/);
    expect(mocks.tableClient.getEntity).toHaveBeenCalledWith(
      'rl-em:hash_jan@example.com',
      expect.any(String),
    );
  });

  it('returns 429 even when a Turnstile token is present', async () => {
    process.env.TURNSTILE_SECRET = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    }));
    const res = await handler(makeReq({
      formData: { ...validForm, 'cf-turnstile-response': 'valid-token' },
    }), ctx);
    expect(res.status).toBe(429);
  });
});
