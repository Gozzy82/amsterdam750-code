import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  updateEntity: vi.fn(),
  http: vi.fn(),
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class DefaultAzureCredential {},
}));

vi.mock('@azure/functions', () => ({
  app: {
    http: mocks.http,
  },
}));

import { resetPreRegistrations } from './index.js';

describe('resetPreRegistrations', () => {
  beforeEach(() => {
    process.env.TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    delete process.env.TABLE_NAME;

    mocks.updateEntity.mockReset();
    mocks.http.mockReset();
    mocks.fromConnectionString.mockReset();
  });

  it('preserves invite tokens while resetting invite status metadata', async () => {
    mocks.fromConnectionString.mockReturnValue({
      listEntities: () => (async function* listEntities() {
        yield { partitionKey: 'pre-test', rowKey: 'USER_001', inviteToken: 'old-token-1' };
        yield { partitionKey: 'pre-test', rowKey: 'USER_002', inviteToken: 'old-token-2' };
      })(),
      updateEntity: mocks.updateEntity,
    });

    const result = await resetPreRegistrations();

    expect(result).toEqual({ reset: 2, tableName: 'PreRegistrations' });
    expect(mocks.fromConnectionString).toHaveBeenCalledWith('UseDevelopmentStorage=true', 'PreRegistrations');
    expect(mocks.updateEntity).toHaveBeenCalledTimes(2);

    for (const [entity, mode] of mocks.updateEntity.mock.calls) {
      expect(mode).toBe('Merge');
      expect(entity).toMatchObject({
        inviteStatus: 'pending',
        inviteQueuedAt: '',
        inviteSentAt: '',
        inviteError: '',
      });
      expect(entity).not.toHaveProperty('inviteToken');
    }
  });
});
