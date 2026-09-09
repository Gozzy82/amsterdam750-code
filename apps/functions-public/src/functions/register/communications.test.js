import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock("twilio");
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
});

describe("communications dynamic imports", () => {
  it("surfaces a clear error when Twilio import fails", async () => {
    vi.doMock("twilio", () => {
      throw new Error("mock twilio import failure");
    });

    process.env.TWILIO_ACCOUNT_SID = "sid";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+31000000000";

    const { sendOtpViaSms } = await import("./communications.js");

    await expect(sendOtpViaSms("+31612345678", "12-34-56")).rejects.toThrow(
      "SMS verzending: kon module 'twilio' niet laden",
    );
  });
});
