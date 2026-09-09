import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeClientPrincipalHeader,
  requireAuthenticatedAdmin,
} from "./admin-auth.js";

describe("requireAuthenticatedAdmin", () => {
  beforeEach(() => {
    delete process.env.ALLOW_LOCAL_ADMIN_BYPASS;
    delete process.env.WEBSITE_INSTANCE_ID;
    delete process.env.AzureWebJobsStorage;
  });

  it("returns 401 when the Easy Auth client principal header is missing", () => {
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin({ method: "POST" }, context, {
      action: "delete-preregistrations",
      auditOnFailure: true,
    });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
    expect(JSON.parse(result.response.body)).toEqual({
      ok: false,
      error: "Admin-authenticatie ontbreekt of is ongeldig.",
    });
    expect(context.log).toHaveBeenCalledWith(
      "admin-auth unauthorized",
      expect.objectContaining({
        action: "delete-preregistrations",
        reason: "missing-client-principal",
        method: "POST",
      })
    );
    expect(context.log).toHaveBeenCalledWith(
      "admin-audit",
      expect.objectContaining({
        eventName: "delete-preregistrations",
        outcome: "denied",
        reason: "missing-client-principal",
      })
    );
  });

  it("returns the decoded principal when the header is valid", () => {
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        headers: {
          get: () =>
            encodeClientPrincipalHeader({
              userId: "user-123",
              userDetails: "admin@example.com",
              identityProvider: "aad",
              userRoles: ["authenticated", "admin"],
            }),
        },
      },
      context,
      { action: "stats" }
    );

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "user-123",
        userDetails: "admin@example.com",
        identityProvider: "aad",
        userRoles: ["authenticated", "admin"],
      },
    });
    expect(context.log).not.toHaveBeenCalled();
  });

  it("falls back to claims when Easy Auth omits the top-level userId", () => {
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        headers: {
          get: () =>
            encodeClientPrincipalHeader({
              userId: "",
              userDetails: "",
              userRoles: ["authenticated", "admin"],
              claims: [
                {
                  typ: "http://schemas.microsoft.com/identity/claims/objectidentifier",
                  val: "entra-object-id-123",
                },
                {
                  typ: "preferred_username",
                  val: "admin@example.com",
                },
              ],
            }),
        },
      },
      context,
      { action: "stats" }
    );

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "entra-object-id-123",
        userDetails: "admin@example.com",
        identityProvider: "aad",
        userRoles: ["authenticated", "admin"],
      },
    });
    expect(context.log).not.toHaveBeenCalled();
  });

  it("returns 403 when an authenticated user does not have the admin role", () => {
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "POST",
        headers: {
          get: () =>
            encodeClientPrincipalHeader({
              userId: "user-123",
              userDetails: "user@example.com",
              userRoles: ["authenticated"],
            }),
        },
      },
      context,
      {
        action: "send-invites",
        auditOnFailure: true,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
    expect(JSON.parse(result.response.body)).toEqual({
      ok: false,
      error: "Voor deze actie is de adminrol vereist.",
    });
    expect(context.log).toHaveBeenCalledWith(
      "admin-auth forbidden",
      expect.objectContaining({
        action: "send-invites",
        reason: "missing-admin-role",
        principal: expect.objectContaining({
          userId: "user-123",
          userRoles: ["authenticated"],
        }),
      })
    );
    expect(context.log).toHaveBeenCalledWith(
      "admin-audit",
      expect.objectContaining({
        eventName: "send-invites",
        outcome: "denied",
        reason: "missing-admin-role",
        actor: expect.objectContaining({
          userId: "user-123",
        }),
      })
    );
  });

  it("accepts the admin role from Easy Auth role claims", () => {
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        headers: {
          get: () =>
            encodeClientPrincipalHeader({
              userRoles: [],
              claims: [
                {
                  typ: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
                  val: "admin",
                },
              ],
            }),
        },
      },
      context,
      { action: "stats" }
    );

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "test-user-id",
        userDetails: "admin@example.com",
        identityProvider: "aad",
        userRoles: ["admin"],
      },
    });
    expect(context.log).not.toHaveBeenCalled();
  });

  it("allows localhost requests when the local bypass setting is enabled", () => {
    process.env.ALLOW_LOCAL_ADMIN_BYPASS = "true";
    process.env.AzureWebJobsStorage = "UseDevelopmentStorage=true";
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        url: "http://localhost:7072/api/stats",
      },
      context,
      { action: "stats" }
    );

    expect(result).toEqual({
      ok: true,
      principal: {
        userId: "local-dev",
        userDetails: "localhost-bypass",
        identityProvider: "local",
        userRoles: ["local-dev"],
      },
    });
    expect(context.log).toHaveBeenCalledWith(
      "admin-auth local bypass",
      expect.objectContaining({
        action: "stats",
        setting: "ALLOW_LOCAL_ADMIN_BYPASS",
        url: "http://localhost:7072/api/stats",
      })
    );
  });

  it("does not allow non-local requests when the bypass setting is enabled", () => {
    process.env.ALLOW_LOCAL_ADMIN_BYPASS = "true";
    process.env.AzureWebJobsStorage = "UseDevelopmentStorage=true";
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        url: "https://example.com/api/stats",
      },
      context,
      { action: "stats" }
    );

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it("does not allow the bypass when running in Azure", () => {
    process.env.ALLOW_LOCAL_ADMIN_BYPASS = "true";
    process.env.AzureWebJobsStorage = "UseDevelopmentStorage=true";
    process.env.WEBSITE_INSTANCE_ID = "azure-instance";
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        url: "http://localhost:7072/api/stats",
      },
      context,
      { action: "stats" }
    );

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it("does not allow the bypass when storage is not Azurite", () => {
    process.env.ALLOW_LOCAL_ADMIN_BYPASS = "true";
    process.env.AzureWebJobsStorage = "DefaultEndpointsProtocol=https;AccountName=prod;";
    const context = { log: vi.fn() };

    const result = requireAuthenticatedAdmin(
      {
        method: "GET",
        url: "http://localhost:7072/api/stats",
      },
      context,
      { action: "stats" }
    );

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });
});
