import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableClient } from '@azure/data-tables';
import { QueueServiceClient } from '@azure/storage-queue';
import { encodeClientPrincipalHeader } from '../../lib/admin-auth.js';

const handlers = vi.hoisted(() => ({
  http: new Map(),
  queue: new Map(),
}));

const sentEmails = vi.hoisted(() => []);

vi.mock('@azure/functions', () => ({
  app: {
    http: (name, def) => handlers.http.set(name, def.handler),
    storageQueue: (name, def) => handlers.queue.set(name, def.handler),
  },
}));

vi.mock('@azure/communication-email', () => ({
  EmailClient: class {
    constructor(_conn) {}
    async beginSend(message) {
      sentEmails.push(message);
      return { pollUntilDone: async () => ({ status: 'Succeeded' }) };
    }
  },
}));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(_url, _cred) {}
    async getSecret(_name) {
      return { value: 'endpoint=https://local.communication.azure.com/;accesskey=fake' };
    }
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
}));

vi.mock('@gozzy82/amsterdam750-shared/keyvault', () => ({
  envelopeFromString: (s) => JSON.parse(String(s || '{}')),
  decryptPiiString: async ({ envelope }) => JSON.stringify(envelope),
}));

const ctx = { log: vi.fn() };

const TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
const QUEUE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
const TABLE_NAME = 'PreRegistrationsIntegration';
const PHONE_LOCK_TABLE_NAME = 'PhoneLocksIntegration';
const STATS_TABLE_NAME = 'StatsIntegration';
const QUEUE_NAME = 'invite-jobs';

const tableClient = TableClient.fromConnectionString(TABLE_CONNECTION_STRING, TABLE_NAME);
const phoneLockTableClient = TableClient.fromConnectionString(TABLE_CONNECTION_STRING, PHONE_LOCK_TABLE_NAME);
const statsTableClient = TableClient.fromConnectionString(TABLE_CONNECTION_STRING, STATS_TABLE_NAME);
const queueClient = QueueServiceClient.fromConnectionString(QUEUE_CONNECTION_STRING).getQueueClient(QUEUE_NAME);

async function purgeTable(client) {
  const toDelete = [];
  for await (const entity of client.listEntities()) {
    toDelete.push({ partitionKey: entity.partitionKey, rowKey: entity.rowKey });
  }
  for (const entity of toDelete) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey).catch(() => {});
  }
}

async function purgeQueue(client) {
  await client.clearMessages().catch(() => {});
}

function makeHttpRequest({ method = 'POST', body = {}, authenticated = true } = {}) {
  const headers = new Map();
  if (authenticated) {
    headers.set('x-ms-client-principal', encodeClientPrincipalHeader());
  }

  return {
    method,
    headers: {
      get: (name) => headers.get(String(name).toLowerCase()) ?? null,
    },
    json: async () => body,
  };
}

beforeAll(async () => {
  delete process.env.ALLOW_LOCAL_ADMIN_BYPASS;
  process.env.TABLE_CONNECTION_STRING = TABLE_CONNECTION_STRING;
  process.env.AzureWebJobsStorage = QUEUE_CONNECTION_STRING;
  process.env.TABLE_NAME = TABLE_NAME;
  process.env.PHONE_LOCK_TABLE_NAME = PHONE_LOCK_TABLE_NAME;
  process.env.STATS_TABLE_NAME = STATS_TABLE_NAME;
  process.env.QUEUE_NAME = QUEUE_NAME;
  process.env.INVITE_BASE_URL = 'http://localhost:8080/register/?token=';
  process.env.KV_URL = 'https://kv.local.test';
  process.env.COMMUNICATIONS_SECRET_NAME = 'communications-connection-string';
  process.env.EMAIL_FROM = 'DoNotReply@example.azurecomm.net';

  await tableClient.createTable().catch((e) => { if (e.statusCode !== 409) throw e; });
  await phoneLockTableClient.createTable().catch((e) => { if (e.statusCode !== 409) throw e; });
  await statsTableClient.createTable().catch((e) => { if (e.statusCode !== 409) throw e; });
  await queueClient.createIfNotExists();

  await import('../send-invites/index.js');
  await import('../invite-worker/index.js');
  await import('../reset-preregistrations/index.js');
  await import('../delete-preregistrations/index.js');
  await import('../stats/index.js');
}, 30000);

beforeEach(async () => {
  sentEmails.length = 0;
  ctx.log.mockClear();
  await purgeTable(tableClient);
  await purgeTable(phoneLockTableClient);
  await purgeTable(statsTableClient);
  await purgeQueue(queueClient);
});

describe('invite integration flow (Azurite)', () => {
  it('queues invite job and processes worker to sent state', async () => {
    const sendInvites = handlers.http.get('send-invites');
    const inviteWorker = handlers.queue.get('invite-worker');

    expect(sendInvites).toBeTypeOf('function');
    expect(inviteWorker).toBeTypeOf('function');

    await tableClient.createEntity({
      partitionKey: 'pre-test',
      rowKey: 'USER_001',
      kind: 'user',
      pii: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }),
      consent: true,
      createdAt: new Date().toISOString(),
    });

    const sendRes = await sendInvites(makeHttpRequest({ method: 'POST', body: { dryRun: false } }), ctx);
    expect(sendRes.status).toBe(200);

    const payload = JSON.parse(sendRes.body);
    expect(payload.ok).toBe(true);
    expect(payload.queued).toBe(1);

    const received = await queueClient.receiveMessages({ numberOfMessages: 1, visibilityTimeout: 1 });
    expect(received.receivedMessageItems.length).toBe(1);

    const msg = received.receivedMessageItems[0];
    const job = JSON.parse(msg.messageText);
    expect(job.partitionKey).toBe('pre-test');
    expect(job.rowKey).toBe('USER_001');
    expect(job.inviteToken).toMatch(/^[0-9a-f-]{36}$/i);

    await inviteWorker(job, ctx);

    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].content.html).toContain(job.inviteToken);

    const updated = await tableClient.getEntity('pre-test', 'USER_001');
    expect(updated.inviteStatus).toBe('sent');
    expect(updated.inviteSentAt).toBeTruthy();

    await queueClient.deleteMessage(msg.messageId, msg.popReceipt);
  }, 30000);

  it('resets invite status so records can be invited again', async () => {
    const sendInvites = handlers.http.get('send-invites');
    const resetPreRegistrations = handlers.http.get('reset-preregistrations');
    expect(sendInvites).toBeTypeOf('function');
    expect(resetPreRegistrations).toBeTypeOf('function');

    await tableClient.createEntity({
      partitionKey: 'pre-test',
      rowKey: 'USER_001',
      kind: 'user',
      pii: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }),
      consent: true,
      createdAt: new Date().toISOString(),
      inviteStatus: 'sent',
      inviteToken: 'old-token-1',
      inviteSentAt: new Date().toISOString(),
    });
    await tableClient.createEntity({
      partitionKey: 'pre-test',
      rowKey: 'USER_002',
      kind: 'user',
      pii: JSON.stringify({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' }),
      consent: true,
      createdAt: new Date().toISOString(),
      inviteStatus: 'queued',
      inviteToken: 'old-token-2',
      inviteQueuedAt: new Date().toISOString(),
    });

    const unauthenticatedReset = await resetPreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: true }, authenticated: false }),
      ctx
    );
    expect(unauthenticatedReset.status).toBe(401);

    const missingConfirm = await resetPreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: false } }),
      ctx
    );
    expect(missingConfirm.status).toBe(400);

    const resetResponse = await resetPreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: true } }),
      ctx
    );
    expect(resetResponse.status).toBe(200);

    const payload = JSON.parse(resetResponse.body);
    expect(payload.ok).toBe(true);
    expect(payload.reset).toBe(2);

    const first = await tableClient.getEntity('pre-test', 'USER_001');
    const second = await tableClient.getEntity('pre-test', 'USER_002');
    expect(first.inviteStatus).toBe('pending');
    expect(second.inviteStatus).toBe('pending');
    expect(first.inviteToken).toBe('old-token-1');
    expect(second.inviteToken).toBe('old-token-2');

    const requeueResponse = await sendInvites(makeHttpRequest({ method: 'POST', body: { dryRun: false } }), ctx);
    const requeuePayload = JSON.parse(requeueResponse.body);
    expect(requeueResponse.status).toBe(200);
    expect(requeuePayload.ok).toBe(true);
    expect(requeuePayload.queued).toBe(2);
  }, 30000);

  it('deletes users and uniqueness locks for full preregistration cleanup', async () => {
    const deletePreRegistrations = handlers.http.get('delete-preregistrations');
    const stats = handlers.http.get('stats');
    expect(deletePreRegistrations).toBeTypeOf('function');
    expect(stats).toBeTypeOf('function');

    await tableClient.createEntity({
      partitionKey: 'pre-test',
      rowKey: 'USER_001',
      kind: 'user',
      pii: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+31612345678' }),
      consent: true,
      createdAt: new Date().toISOString(),
    });
    await tableClient.createEntity({
      partitionKey: 'pre-test',
      rowKey: 'EMAIL_hash-001',
      kind: 'uniq-email',
      userRowKey: 'USER_001',
      createdAt: new Date().toISOString(),
    });
    await phoneLockTableClient.createEntity({
      partitionKey: 'phone',
      rowKey: 'phone-hash-001',
      userRowKey: 'USER_001',
      createdAt: new Date().toISOString(),
    });
    await statsTableClient.upsertEntity({
      partitionKey: 'global',
      rowKey: 'counters',
      registrations: 1,
      challenge_shown: 43,
      challenge_passed: 37,
      challenge_failed: 2,
      blocked_honeypot: 3,
      lastUpdated: new Date().toISOString(),
    }, 'Replace');

    const cachedStatsResponse = await stats(makeHttpRequest({ method: 'GET' }), ctx);
    expect(cachedStatsResponse.status).toBe(200);
    const cachedStatsPayload = JSON.parse(cachedStatsResponse.body);
    expect(cachedStatsPayload.totalRegistrations).toBe(1);
    expect(cachedStatsPayload.counters.challenge_shown).toBe(43);

    const unauthenticatedDelete = await deletePreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: true }, authenticated: false }),
      ctx
    );
    expect(unauthenticatedDelete.status).toBe(401);

    const missingConfirm = await deletePreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: false } }),
      ctx
    );
    expect(missingConfirm.status).toBe(400);

    const deleteResponse = await deletePreRegistrations(
      makeHttpRequest({ method: 'POST', body: { confirm: true } }),
      ctx
    );
    expect(deleteResponse.status).toBe(200);

    const payload = JSON.parse(deleteResponse.body);
    expect(payload.ok).toBe(true);
    expect(payload.reinitializedTables).toEqual(['PreRegistrationsIntegration', 'PhoneLocksIntegration', 'StatsIntegration']);

    await expect(tableClient.getEntity('pre-test', 'USER_001')).rejects.toMatchObject({ statusCode: 404 });
    await expect(tableClient.getEntity('pre-test', 'EMAIL_hash-001')).rejects.toMatchObject({ statusCode: 404 });
    await expect(phoneLockTableClient.getEntity('phone', 'phone-hash-001')).rejects.toMatchObject({ statusCode: 404 });

    const statsResponse = await stats(makeHttpRequest({ method: 'GET' }), ctx);
    expect(statsResponse.status).toBe(200);
    const statsPayload = JSON.parse(statsResponse.body);
    expect(statsPayload.totalRegistrations).toBe(0);
    expect(statsPayload.counters).toMatchObject({
      registrations: 0,
      challenge_shown: 0,
      challenge_passed: 0,
      challenge_failed: 0,
      blocked_honeypot: 0,
    });
  }, 30000);
});
