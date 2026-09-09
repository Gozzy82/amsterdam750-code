const CLIENT_PRINCIPAL_HEADER = "x-ms-client-principal";
const LOCAL_ADMIN_BYPASS_SETTING = "ALLOW_LOCAL_ADMIN_BYPASS";
const AZURE_INSTANCE_ID_SETTING = "WEBSITE_INSTANCE_ID";
const AZURE_STORAGE_SETTING = "AzureWebJobsStorage";
const LOCAL_STORAGE_CONNECTION = "UseDevelopmentStorage=true";
const REQUIRED_ADMIN_ROLE = "admin";

function jsonResponse(status, payload) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function getHeaderValue(request, headerName) {
  const headers = request?.headers;
  if (!headers) {
    return null;
  }

  if (typeof headers.get === "function") {
    return headers.get(headerName);
  }

  if (headers instanceof Map) {
    return headers.get(headerName) ?? headers.get(headerName.toLowerCase()) ?? null;
  }

  if (typeof headers === "object") {
    const match = Object.entries(headers).find(([key]) => key.toLowerCase() === headerName);
    return match ? match[1] : null;
  }

  return null;
}

function decodeClientPrincipal(encodedPrincipal) {
  if (typeof encodedPrincipal !== "string" || encodedPrincipal.trim() === "") {
    return { ok: false, reason: "missing-client-principal" };
  }

  try {
    const decoded = Buffer.from(encodedPrincipal, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    if (!principal || typeof principal !== "object") {
      return { ok: false, reason: "invalid-client-principal" };
    }

    const userId = normalizePrincipalUserId(principal);
    const authType = typeof principal.auth_typ === "string" ? principal.auth_typ.trim().toLowerCase() : "";

    if (!userId) {
      return { ok: false, reason: "missing-user-id" };
    }

    if (authType === "anonymous") {
      return { ok: false, reason: "anonymous-principal" };
    }

    return {
      ok: true,
      principal: {
        userId,
        userDetails: normalizePrincipalUserDetails(principal),
        identityProvider: typeof principal.identityProvider === "string" ? principal.identityProvider : "",
        userRoles: normalizePrincipalUserRoles(principal),
      },
    };
  } catch {
    return { ok: false, reason: "invalid-client-principal" };
  }
}

function getClaimEntries(principal) {
  return Array.isArray(principal?.claims) ? principal.claims : [];
}

function readClaimField(claim, fieldNames) {
  for (const fieldName of fieldNames) {
    const rawValue = claim?.[fieldName];
    if (typeof rawValue === "string" && rawValue.trim() !== "") {
      return rawValue.trim();
    }
  }

  return "";
}

function getClaimValue(principal, claimTypes) {
  const normalizedClaimTypes = claimTypes.map((claimType) => claimType.toLowerCase());

  for (const claim of getClaimEntries(principal)) {
    const claimType = readClaimField(claim, ["typ", "type", "claimType"]).toLowerCase();
    if (!claimType || !normalizedClaimTypes.includes(claimType)) {
      continue;
    }

    const claimValue = readClaimField(claim, ["val", "value", "claimValue"]);
    if (claimValue) {
      return claimValue;
    }
  }

  return "";
}

function normalizePrincipalUserId(principal) {
  if (typeof principal.userId === "string" && principal.userId.trim() !== "") {
    return principal.userId.trim();
  }

  return getClaimValue(principal, [
    "http://schemas.microsoft.com/identity/claims/objectidentifier",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
    "oid",
    "sub",
  ]);
}

function normalizePrincipalUserDetails(principal) {
  if (typeof principal.userDetails === "string" && principal.userDetails.trim() !== "") {
    return principal.userDetails.trim();
  }

  return getClaimValue(principal, [
    "preferred_username",
    "email",
    "upn",
    "name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  ]);
}

function normalizePrincipalUserRoles(principal) {
  const roles = Array.isArray(principal.userRoles) ? [...principal.userRoles] : [];
  const roleClaimTypes = new Set([
    "role",
    "roles",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  ]);

  if (typeof principal.role_typ === "string" && principal.role_typ.trim() !== "") {
    roleClaimTypes.add(principal.role_typ.trim().toLowerCase());
  }

  for (const claim of getClaimEntries(principal)) {
    const claimType = readClaimField(claim, ["typ", "type", "claimType"]).toLowerCase();
    if (roleClaimTypes.has(claimType)) {
      roles.push(readClaimField(claim, ["val", "value", "claimValue"]));
    }
  }

  return [
    ...new Set(
      roles
        .filter((role) => typeof role === "string")
        .map((role) => role.trim())
        .filter((role) => role && role !== "anonymous")
    ),
  ];
}

function requestMetadata(request) {
  return {
    method: request?.method ?? "",
    url: request?.url ?? "",
  };
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLoopbackRequest(request) {
  const requestUrl = request?.url;
  if (typeof requestUrl === "string" && requestUrl) {
    try {
      return isLoopbackHostname(new URL(requestUrl).hostname);
    } catch {
      return false;
    }
  }

  const hostHeader = getHeaderValue(request, "host");
  if (typeof hostHeader === "string" && hostHeader) {
    const hostname = hostHeader.split(":")[0].trim().toLowerCase();
    return isLoopbackHostname(hostname);
  }

  return false;
}

function isLocalAdminBypassEnabled(request) {
  return (
    process.env[LOCAL_ADMIN_BYPASS_SETTING] === "true"
    && !process.env[AZURE_INSTANCE_ID_SETTING]
    && process.env[AZURE_STORAGE_SETTING] === LOCAL_STORAGE_CONNECTION
    && isLoopbackRequest(request)
  );
}

export function encodeClientPrincipalHeader(principal = {}) {
  return Buffer.from(
    JSON.stringify({
      auth_typ: "aad",
      claims: [],
      identityProvider: "aad",
      name_typ: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      role_typ: "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
      userId: "test-user-id",
      userDetails: "admin@example.com",
      userRoles: ["authenticated", REQUIRED_ADMIN_ROLE],
      ...principal,
    }),
    "utf8"
  ).toString("base64");
}

export function logAdminAuditEvent(context, eventName, { outcome, principal = null, reason = "", details = {} } = {}) {
  context.log("admin-audit", {
    eventName,
    outcome,
    at: new Date().toISOString(),
    actor: principal
      ? {
          userId: principal.userId,
          userDetails: principal.userDetails,
          identityProvider: principal.identityProvider,
          userRoles: principal.userRoles,
        }
      : null,
    reason,
    details,
  });
}

export function requireAuthenticatedAdmin(request, context, { action = "admin-request", auditOnFailure = false } = {}) {
  if (isLocalAdminBypassEnabled(request)) {
    const principal = {
      userId: "local-dev",
      userDetails: "localhost-bypass",
      identityProvider: "local",
      userRoles: ["local-dev"],
    };
    context.log("admin-auth local bypass", {
      action,
      setting: LOCAL_ADMIN_BYPASS_SETTING,
      ...requestMetadata(request),
    });
    return { ok: true, principal };
  }

  const result = decodeClientPrincipal(getHeaderValue(request, CLIENT_PRINCIPAL_HEADER));
  if (result.ok) {
    if (result.principal.userRoles.includes(REQUIRED_ADMIN_ROLE)) {
      return { ok: true, principal: result.principal };
    }

    const reason = "missing-admin-role";
    context.log("admin-auth forbidden", {
      action,
      reason,
      principal: result.principal,
      ...requestMetadata(request),
    });

    if (auditOnFailure) {
      logAdminAuditEvent(context, action, {
        outcome: "denied",
        principal: result.principal,
        reason,
        details: requestMetadata(request),
      });
    }

    return {
      ok: false,
      response: jsonResponse(403, {
        ok: false,
        error: "Voor deze actie is de adminrol vereist.",
      }),
    };
  }

  context.log("admin-auth unauthorized", {
    action,
    reason: result.reason,
    ...requestMetadata(request),
  });

  if (auditOnFailure) {
    logAdminAuditEvent(context, action, {
      outcome: "denied",
      reason: result.reason,
      details: requestMetadata(request),
    });
  }

  return {
    ok: false,
    response: jsonResponse(401, {
      ok: false,
      error: "Admin-authenticatie ontbreekt of is ongeldig.",
    }),
  };
}
