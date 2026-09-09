import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestOtp, verifyOtp } from './handlers.js';

const mocks = vi.hoisted(() => ({
  sendOtpViaSms: vi.fn(),
  getOtpEntity: vi.fn(),
  getUserEntity: vi.fn(),
  getPhoneHashForUser: vi.fn(),
  storeOtpCode: vi.fn(),
  claimOtpAttempt: vi.fn(),
  deleteOtpCode: vi.fn(),
  markUserAsVerified: vi.fn(),
}));

vi.mock('./communications.js', () => ({
  sendOtpViaSms: mocks.sendOtpViaSms,
}));

vi.mock('./database.js', () => ({
  getOtpEntity: mocks.getOtpEntity,
  getUserEntity: mocks.getUserEntity,
  getPhoneHashForUser: mocks.getPhoneHashForUser,
  storeOtpCode: mocks.storeOtpCode,
  claimOtpAttempt: mocks.claimOtpAttempt,
  deleteOtpCode: mocks.deleteOtpCode,
  markUserAsVerified: mocks.markUserAsVerified,
}));

const mockContext = { log: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserEntity.mockResolvedValue({
    partitionKey: 'user',
    rowKey: 'token123',
    phoneHash: 'fab7be8a931d1088a82f6acf9e468aaf6a3accc07d5112ee5d6fca93281e1583',
  });
  mocks.getPhoneHashForUser.mockResolvedValue(null);
});

describe('requestOtp - SMS Rate Limiting', () => {
  it('sends SMS and increments count on first request', async () => {
    mocks.getOtpEntity.mockResolvedValue(null);

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(200);
    expect(mocks.storeOtpCode).toHaveBeenCalledWith(
      otpTable,
      expect.any(String),
      expect.any(String),
      '+316****678',
      1
    );
    expect(mocks.sendOtpViaSms).toHaveBeenCalled();
  });

  it('increments SMS count on second request within 12 hours', async () => {
    const now = new Date();
    mocks.getOtpEntity.mockResolvedValue({
      smsSentCount: 1,
      lastSmsSentAt: now.toISOString(),
      code: '123456',
      attempts: 0,
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(200);
    expect(mocks.storeOtpCode).toHaveBeenCalledWith(
      otpTable,
      expect.any(String),
      expect.any(String),
      '+316****678',
      2
    );
  });

  it('increments SMS count on third request within 12 hours', async () => {
    const now = new Date();
    mocks.getOtpEntity.mockResolvedValue({
      smsSentCount: 2,
      lastSmsSentAt: now.toISOString(),
      code: '123456',
      attempts: 0,
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(200);
    expect(mocks.storeOtpCode).toHaveBeenCalledWith(
      otpTable,
      expect.any(String),
      expect.any(String),
      '+316****678',
      3
    );
  });

  it('returns 429 when 3 SMS codes requested within 12 hours', async () => {
    const now = new Date();
    mocks.getOtpEntity.mockResolvedValue({
      smsSentCount: 3,
      lastSmsSentAt: now.toISOString(),
      code: '123456',
      attempts: 0,
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(429);
    expect(res.body).toContain('Te veel verzoeken');
    expect(res.body).toContain('12 uur');
    expect(mocks.sendOtpViaSms).not.toHaveBeenCalled();
  });

  it('returns 429 with remaining hours when rate limited', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    mocks.getOtpEntity.mockResolvedValue({
      smsSentCount: 3,
      lastSmsSentAt: oneHourAgo.toISOString(),
      code: '123456',
      attempts: 0,
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(429);
    expect(res.body).toContain('11 uur');
    expect(mocks.sendOtpViaSms).not.toHaveBeenCalled();
  });

  it('still rate limits when the previous OTP was already cleared', async () => {
    const now = new Date();
    mocks.getOtpEntity.mockResolvedValue({
      partitionKey: 'otp',
      rowKey: 'token123',
      smsSentCount: 3,
      lastSmsSentAt: now.toISOString(),
      maskedPhone: '+316****678',
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(429);
    expect(res.body).toContain('Te veel verzoeken');
    expect(mocks.sendOtpViaSms).not.toHaveBeenCalled();
  });

  it('allows SMS request after 12 hours lockout expires', async () => {
    const now = new Date();
    const moreThan12HoursAgo = new Date(now.getTime() - 13 * 60 * 60 * 1000);
    
    mocks.getOtpEntity.mockResolvedValue({
      smsSentCount: 3,
      lastSmsSentAt: moreThan12HoursAgo.toISOString(),
      code: '123456',
      attempts: 0,
    });

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(200);
    expect(mocks.storeOtpCode).toHaveBeenCalledWith(
      otpTable,
      expect.any(String),
      expect.any(String),
      '+316****678',
      1
    );
    expect(mocks.sendOtpViaSms).toHaveBeenCalled();
  });

  it('returns 400 when phone is missing', async () => {
    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '', 'http://localhost', mockContext);

    expect(res.status).toBe(400);
    expect(res.body).toContain('Telefoonnummer is verplicht');
  });

  it('returns 422 when phone is invalid', async () => {
    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', 'invalid-phone', 'http://localhost', mockContext);

    expect(res.status).toBe(422);
    expect(res.body).toContain('Telefoonnummer is ongeldig');
  });

  it('returns 422 when phone does not match pre-registration', async () => {
    mocks.getOtpEntity.mockResolvedValue(null);

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31687654321', 'http://localhost', mockContext);

    expect(res.status).toBe(422);
    expect(res.body).toContain('komt niet overeen');
  });

  it('falls back to the phone lock table for older preregistrations without phoneHash', async () => {
    mocks.getUserEntity.mockResolvedValue({
      partitionKey: 'user',
      rowKey: 'legacy-user-row',
    });
    mocks.getPhoneHashForUser.mockResolvedValue('fab7be8a931d1088a82f6acf9e468aaf6a3accc07d5112ee5d6fca93281e1583');
    mocks.getOtpEntity.mockResolvedValue(null);

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(200);
    expect(mocks.getPhoneHashForUser).toHaveBeenCalledWith(phoneLockTable, 'legacy-user-row');
  });

  it('returns 500 when no phone hash can be resolved for the preregistration', async () => {
    mocks.getUserEntity.mockResolvedValue({
      partitionKey: 'user',
      rowKey: 'legacy-user-row',
    });
    mocks.getOtpEntity.mockResolvedValue(null);

    const otpTable = {};
    const preregTable = {};
    const phoneLockTable = {};

    const res = await requestOtp(otpTable, preregTable, phoneLockTable, 'token123', '+31612345678', 'http://localhost', mockContext);

    expect(res.status).toBe(500);
    expect(res.body).toContain('kan momenteel niet worden geverifieerd');
    expect(mockContext.log).toHaveBeenCalledWith('register.otp.request.phone_hash_missing', { userRowKey: 'legacy-user-row' });
  });
});

describe('verifyOtp', () => {
  it('treats an entity without an active code as expired', async () => {
    mocks.claimOtpAttempt.mockResolvedValue({ status: 'notFound' });

    const res = await verifyOtp({}, {}, 'token123', 'token123', '123456', 'http://localhost', mockContext);

    expect(res.status).toBe(422);
    expect(res.body).toContain('Verificatiecode verlopen');
    expect(res.body).toContain("data-reload-after-ms='5000'");
    expect(res.body).toContain('5 seconden opnieuw geladen');
    expect(mocks.deleteOtpCode).not.toHaveBeenCalled();
  });

  it('deletes and rejects a code older than 30 minutes', async () => {
    const otpTable = {};
    const otpEntity = {
      partitionKey: 'otp',
      rowKey: 'token123',
      code: '123456',
      createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      attempts: 0,
      maskedPhone: '+316****678',
    };
    mocks.claimOtpAttempt.mockResolvedValue({ status: 'claimed', otpEntity, attempts: 1 });

    const res = await verifyOtp(otpTable, {}, 'token123', 'token123', '123456', 'http://localhost', mockContext);

    expect(res.status).toBe(422);
    expect(res.body).toContain('Verificatiecode verlopen');
    expect(mocks.deleteOtpCode).toHaveBeenCalledWith(otpTable, otpEntity);
    expect(mocks.getUserEntity).not.toHaveBeenCalled();
    expect(mocks.markUserAsVerified).not.toHaveBeenCalled();
    expect(mockContext.log).toHaveBeenCalledWith(
      'register.otp.verify.expired',
      expect.objectContaining({ tokenRef: 'token123' }),
    );
  });

  it('invalidates the code after too many attempts and tells the client to reload', async () => {
    const otpEntity = {
      partitionKey: 'otp',
      rowKey: 'token123',
      code: '123456',
      createdAt: new Date().toISOString(),
      attempts: 3,
      maskedPhone: '+316****678',
    };
    mocks.claimOtpAttempt.mockResolvedValue({ status: 'limitReached', otpEntity });

    const res = await verifyOtp({}, {}, 'token123', 'token123', '123456', 'http://localhost', mockContext);

    expect(res.status).toBe(429);
    expect(res.body).toContain('Te veel pogingen. De code is ongeldig gemaakt.');
    expect(res.body).toContain("data-reload-after-ms='5000'");
    expect(res.body).toContain('5 seconden opnieuw geladen');
    expect(mocks.deleteOtpCode).toHaveBeenCalledTimes(1);
  });

  it('invalidates the code immediately on the final wrong attempt', async () => {
    const otpEntity = {
      partitionKey: 'otp',
      rowKey: 'token123',
      code: '123456',
      createdAt: new Date().toISOString(),
      attempts: 2,
      maskedPhone: '+316****678',
    };
    mocks.claimOtpAttempt.mockResolvedValue({ status: 'claimed', otpEntity, attempts: 3 });

    const res = await verifyOtp({}, {}, 'token123', 'token123', '654321', 'http://localhost', mockContext);

    expect(res.status).toBe(429);
    expect(res.body).toContain('Te veel pogingen. De code is ongeldig gemaakt.');
    expect(res.body).toContain("data-reload-after-ms='5000'");
    expect(res.body).toContain('5 seconden opnieuw geladen');
    expect(res.body).not.toContain('Nog 0 pogingen over');
    expect(mocks.deleteOtpCode).toHaveBeenCalledTimes(1);
  });

  it('claims an attempt before returning a non-final mismatch', async () => {
    const otpEntity = {
      partitionKey: 'otp',
      rowKey: 'token123',
      code: '123456',
      createdAt: new Date().toISOString(),
      attempts: 1,
      etag: 'W/"datetimeetag"',
      maskedPhone: '+316****678',
    };
    mocks.claimOtpAttempt.mockResolvedValue({ status: 'claimed', otpEntity, attempts: 2 });

    const res = await verifyOtp({}, {}, 'token123', 'token123', '654321', 'http://localhost', mockContext);

    expect(res.status).toBe(422);
    expect(res.body).toContain('Nog 1 poging over');
    expect(mocks.claimOtpAttempt).toHaveBeenCalledWith({}, 'token123', 3);
  });
});
