import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const state = vi.hoisted(() => ({
  httpHandlers: new Map(),
  queueHandlers: new Map(),
  tables: new Map(),
  queueMessages: [],
  sentEmails: [],
  sentSms: [],
}));

function keyFor(partitionKey, rowKey) {
  return `${partitionKey}||${rowKey}`;
}

function getTableStore(tableName) {
  if (!state.tables.has(tableName)) state.tables.set(tableName, new Map());
  return state.tables.get(tableName);
}

function parseFilter(filter) {
  if (!filter) return [];
  return String(filter)
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([a-zA-Z0-9_]+)\s+eq\s+'([^']*)'$/);
      return m ? { field: m[1], value: m[2] } : null;
    })
    .filter(Boolean);
}

function entityMatches(entity, filter) {
  const conditions = parseFilter(filter);
  if (!conditions.length) return true;
  return conditions.every(({ field, value }) => String(entity[field]) === value);
}

class MockTableClient {
  constructor(_accountUrl, tableName) {
    this.tableName = tableName;
  }

  static fromConnectionString(_conn, tableName) {
    return new MockTableClient('mock-account', tableName);
  }

  async createTable() {
    getTableStore(this.tableName);
  }

  async createEntity(entity) {
    const table = getTableStore(this.tableName);
    const key = keyFor(entity.partitionKey, entity.rowKey);
    if (table.has(key)) {
      const err = new Error('Conflict');
      err.statusCode = 409;
      throw err;
    }
    table.set(key, { ...entity });
  }

  async getEntity(partitionKey, rowKey) {
    const table = getTableStore(this.tableName);
    const key = keyFor(partitionKey, rowKey);
    const entity = table.get(key);
    if (!entity) {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    }
    return { ...entity };
  }

  async upsertEntity(entity, mode = 'Merge') {
    const table = getTableStore(this.tableName);
    const key = keyFor(entity.partitionKey, entity.rowKey);
    const existing = table.get(key);
    if (!existing || mode === 'Replace') {
      table.set(key, { ...entity });
      return;
    }
    table.set(key, { ...existing, ...entity });
  }

  async updateEntity(entity, mode = 'Merge') {
    const table = getTableStore(this.tableName);
    const key = keyFor(entity.partitionKey, entity.rowKey);
    const existing = table.get(key);
    if (!existing) {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    }
    if (mode === 'Replace') {
      table.set(key, { ...entity });
      return;
    }
    table.set(key, { ...existing, ...entity });
  }

  async deleteEntity(partitionKey, rowKey) {
    const table = getTableStore(this.tableName);
    const key = keyFor(partitionKey, rowKey);
    if (!table.has(key)) {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    }
    table.delete(key);
  }

  async submitTransaction(actions) {
    const table = getTableStore(this.tableName);
    const staged = new Map(table);
    for (const [op, entity] of actions) {
      const key = keyFor(entity.partitionKey, entity.rowKey);
      if (op === 'create') {
        if (staged.has(key)) {
          const err = new Error('Conflict');
          err.statusCode = 409;
          throw err;
        }
        staged.set(key, { ...entity });
      }
    }
    state.tables.set(this.tableName, staged);
  }

  listEntities({ queryOptions } = {}) {
    const table = getTableStore(this.tableName);
    const values = Array.from(table.values()).filter((entity) => entityMatches(entity, queryOptions?.filter));
    return {
      async *[Symbol.asyncIterator]() {
        for (const entity of values) {
          yield { ...entity };
        }
      },
    };
  }
}

vi.mock('@azure/functions', () => ({
  app: {
    http: (name, def) => state.httpHandlers.set(name, def.handler),
    storageQueue: (name, def) => state.queueHandlers.set(name, def.handler),
  },
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: MockTableClient,
}));

vi.mock('@azure/storage-queue', () => ({
  QueueServiceClient: {
    fromConnectionString: () => ({
      getQueueClient: (queueName) => ({
        createIfNotExists: async () => {},
        sendMessage: async (messageText, options) => {
          state.queueMessages.push({ queueName, messageText, options });
        },
      }),
    }),
  },
}));

vi.mock('@azure/communication-email', () => ({
  EmailClient: class {
    constructor(_conn) {}
    async beginSend(message) {
      state.sentEmails.push(message);
      return { pollUntilDone: async () => ({ status: 'Succeeded' }) };
    }
  },
}));

vi.mock('@azure/communication-sms', () => ({
  SmsClient: class {
    constructor(_conn) {}
    async send(payload) {
      state.sentSms.push(payload);
      return { successful: true };
    }
  },
}));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(_url, _cred) {}
    async getSecret(_name) {
      return { value: 'mock-communications-connection' };
    }
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
}));

vi.mock('applicationinsights', () => ({
  default: { defaultClient: null, setup: () => ({
    setAutoDependencyCorrelation: () => ({
      setAutoCollectRequests: () => ({
        setAutoCollectPerformance: () => ({
          setAutoCollectDependencies: () => ({
            setAutoCollectConsole: () => ({
              setUseDiskRetryCaching: () => ({ start: () => {} }),
            }),
          }),
        }),
      }),
    }),
  }) },
}));

vi.mock('twilio', () => ({
  default: (_accountSid, _authToken) => ({
    messages: {
      create: async (payload) => {
        state.sentSms.push({ message: payload.body });
        return { sid: 'mock-message-sid' };
      },
    },
  }),
}));

vi.mock('@gozzy82/amsterdam750-shared', () => ({
  normalizeEmail: (s) => String(s || '').trim().toLowerCase(),
  normalizePhone: (s) => String(s || '').replace(/\s+/g, ''),
  isGuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim()),
  generateMemorableCode: () => '123456',
  formatCode: (code) => `${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}`,
}));

vi.mock('@gozzy82/amsterdam750-shared/keyvault', () => ({
  sha256Hex: (input) => createHash('sha256').update(String(input)).digest('hex'),
  encryptPiiString: async ({ plaintext, aad }) => ({ plaintext, aad }),
  decryptPiiString: async ({ envelope }) => envelope?.plaintext ?? '',
  envelopeToString: (envelope) => JSON.stringify(envelope),
  envelopeFromString: (s) => JSON.parse(String(s || '{}')),
}));

function makeHttpRequest({ method = 'POST', body = '', url = 'http://localhost:7071/api/test', headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    url,
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : {}),
    headers: {
      get: (name) => map.get(String(name).toLowerCase()) ?? null,
    },
  };
}

const ctx = { log: vi.fn() };

beforeAll(async () => {
  process.env.TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  process.env.TABLE_NAME = 'PreRegistrations';
  process.env.RATE_TABLE_NAME = 'PreregistrationRatelimits';
  process.env.STATS_TABLE_NAME = 'Stats';
  process.env.PHONE_LOCK_TABLE_NAME = 'PhoneLocks';
  process.env.OTP_TABLE_NAME = 'OtpCodes';
  process.env.INVITE_BASE_URL = 'https://example.test/register/?token=';
  process.env.KV_URL = 'https://kv.example.test';
  process.env.COMMUNICATIONS_SECRET_NAME = 'communications-connection-string';
  process.env.EMAIL_FROM = 'DoNotReply@example.azurecomm.net';
  process.env.ACS_SMS_FROM = '+31000000000';
  process.env.TWILIO_ACCOUNT_SID = 'mock-account-sid';
  process.env.TWILIO_AUTH_TOKEN = 'mock-auth-token';
  process.env.TWILIO_FROM_NUMBER = '+31000000000';
  process.env.TURNSTILE_SECRET = 'test-secret';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ success: true }),
  }));

  await import('./preregister/index.js');
  await import('./register/index.js');
}, 30000);

beforeEach(() => {
  state.tables.clear();
  state.queueMessages.length = 0;
  state.sentEmails.length = 0;
  state.sentSms.length = 0;
  ctx.log.mockClear();
});

describe('registration flow', () => {
  it('runs preregistration -> simulated invite email -> otp verify successfully', async () => {
    const preregister = state.httpHandlers.get('preregister');
    const register = state.httpHandlers.get('register');

    expect(preregister).toBeTypeOf('function');
    expect(register).toBeTypeOf('function');

    const phone = '+31612345678';
    const preregBody = new URLSearchParams({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone,
      email: 'ada@example.com',
      consent: 'true',
      company: '',
      'cf-turnstile-response': 'valid-token',
    }).toString();

    const preregRes = await preregister(
      makeHttpRequest({ method: 'POST', body: preregBody, url: 'http://localhost:7071/api/preregister' }),
      ctx
    );
    expect(preregRes.status).toBe(200);
    expect(preregRes.body).toContain('pre-registratie is ontvangen');

    // Simulate the admin invite mail step by assigning an invite token to the preregistered user.
    const inviteToken = '123e4567-e89b-42d3-a456-426614174000';
    const preRegTable = getTableStore(process.env.TABLE_NAME || 'PreRegistrations');
    const userEntry = Array.from(preRegTable.entries()).find(([, entity]) => entity.kind === 'user');
    expect(userEntry).toBeTruthy();

    const [userKey, userEntity] = userEntry;
    preRegTable.set(userKey, {
      ...userEntity,
      inviteToken,
      inviteStatus: 'sent',
      inviteSentAt: new Date().toISOString(),
    });

    const inviteUrl = `${process.env.INVITE_BASE_URL}${inviteToken}`;
    state.sentEmails.push({ content: { html: `Klik hier: ${inviteUrl}` } });
    expect(state.sentEmails.length).toBe(1);
    expect(state.sentEmails[0].content.html).toContain(inviteToken);

    const registerStep1Body = new URLSearchParams({
      token: inviteToken,
      phone,
      'cf-turnstile-response': 'valid-token',
    }).toString();
    const registerStep1Res = await register(
      makeHttpRequest({ method: 'POST', body: registerStep1Body, url: 'http://localhost:7071/api/register' }),
      ctx
    );

    expect(registerStep1Res.status).toBe(200);
    expect(registerStep1Res.body).toContain('Voer de code in die je per SMS hebt ontvangen');
    expect(state.sentSms.length).toBe(1);

    const smsMessage = state.sentSms[0]?.message || '';
    const otpMatch = smsMessage.match(/(\d{2})-(\d{2})-(\d{2})/);
    expect(otpMatch).toBeTruthy();
    const otpCode = `${otpMatch[1]}${otpMatch[2]}${otpMatch[3]}`;

    const registerStep2Body = new URLSearchParams({ token: inviteToken, otp: otpCode }).toString();
    const registerStep2Res = await register(
      makeHttpRequest({ method: 'POST', body: registerStep2Body, url: 'http://localhost:7071/api/register' }),
      ctx
    );

    expect(registerStep2Res.status).toBe(200);
    expect(registerStep2Res.body).toContain('Welkom');

    const updatedUser = preRegTable.get(userKey);
    expect(updatedUser.registrationStatus).toBe('verified');
    expect(updatedUser.phoneVerifiedAt).toBeTruthy();
  });
});
