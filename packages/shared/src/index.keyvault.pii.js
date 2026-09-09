/**
 * index.keyvault.pii.js
 *
 * Doel:
 * - Deterministische tokens (voor uniqueness checks) via Key Vault `sign` (RBAC: sign/verify)
 * - Reversible encryptie voor PII via envelope encryption:
 *   - random DEK (AES-256-GCM) per veld/record
 *   - DEK wordt lokaal gewrapt met de public RSA JWK van de KEK (RBAC: Key Reader)
 *
 * Dit bestand is bewust "shared" omdat zowel functions-public & functions-admin dezelfde code gebruiken.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, constants } from "crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { KeyClient, CryptographyClient  } from "@azure/keyvault-keys";

/** base64url helpers (RFC 4648) */
function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/** stable hash for storage rowKeys etc. */
export function sha256Hex(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

/**
 * Create a Key Vault cryptography client for a key name (latest)
 * or a specific key id/version.
 * Caches by key id at runtime (per process).
 */
const _cryptoClientCache = new Map();

export async function getKvCryptoClient({ kvUrl, keyName, credential, keyId } = {}) {
  const KV_URL = kvUrl || process.env.KV_URL;
  const KEY_NAME = keyName || process.env.KEK_KEY_NAME;

  if (!KV_URL) throw new Error("KV_URL ontbreekt");
  if (!keyId && !KEY_NAME) throw new Error("KEK_KEY_NAME ontbreekt");

  const cred = credential || new DefaultAzureCredential();
  if (keyId) {
    if (_cryptoClientCache.has(keyId)) return _cryptoClientCache.get(keyId);
    const cc = new CryptographyClient(keyId, cred);
    _cryptoClientCache.set(keyId, cc);
    return cc;
  }

  const kc = new KeyClient(KV_URL, cred);
  const key = await kc.getKey(KEY_NAME); // latest version
  const cacheKey = key.id;

  if (_cryptoClientCache.has(cacheKey)) return _cryptoClientCache.get(cacheKey);
  const cc = new CryptographyClient(key, cred);
  _cryptoClientCache.set(cacheKey, cc);
  return cc;
}

/**
 * Map an Azure Key Vault algorithm name to Node.js crypto `oaepHash` option.
 * @param {string} alg - e.g. 'RSA-OAEP-256' or 'RSA-OAEP'
 * @returns {string} hash algorithm name for Node.js crypto
 */
function oaepHashForAlg(alg) {
  if (alg === "RSA-OAEP-256") return "sha256";
  if (alg === "RSA-OAEP-384") return "sha384";
  if (alg === "RSA-OAEP-512") return "sha512";
  return "sha1"; // RSA-OAEP (plain) uses SHA-1
}

function jwkBytesToB64u(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  return b64u(Buffer.from(value));
}

/**
 * Fetch the RSA public key from Key Vault and return a Node.js KeyObject for local encryption.
 * Makes exactly one Key Vault call to fetch the public key, then operates locally.
 * Caches by KV_URL + KEY_NAME at runtime (per process).
 *
 * RBAC needed: `Microsoft.KeyVault/vaults/keys/read` (Key Reader).
 */
const _localWrapClientCache = new Map();

export async function getLocalKvWrapClient({ kvUrl, keyName, credential } = {}) {
  const KV_URL = kvUrl || process.env.KV_URL;
  const KEY_NAME = keyName || process.env.KEK_KEY_NAME;

  if (!KV_URL) throw new Error("KV_URL ontbreekt");
  if (!KEY_NAME) throw new Error("KEK_KEY_NAME ontbreekt");

  const cred = credential || new DefaultAzureCredential();
  const cacheKey = `${KV_URL}|${KEY_NAME}`;

  if (!_localWrapClientCache.has(cacheKey)) {
    _localWrapClientCache.set(cacheKey, (async () => {
      const kc = new KeyClient(KV_URL, cred);

      // One Key Vault call: fetch the public key.
      const key = await kc.getKey(KEY_NAME);

      if (!key.key) {
        throw new Error(`Key ${KEY_NAME} bevat geen JsonWebKey`);
      }

      if (key.keyOps && !key.keyOps.includes("wrapKey") && !key.keyOps.includes("encrypt")) {
        throw new Error(`Key ${KEY_NAME} staat encrypt/wrapKey niet toe`);
      }

      // Azure may return JWK n/e as bytes; Node expects base64url strings.
      const jwk = {
        ...key.key,
        n: jwkBytesToB64u(key.key.n),
        e: jwkBytesToB64u(key.key.e),
      };

      // Import the JWK as a Node.js public key — no Azure SDK crypto call needed.
      const publicKey = createPublicKey({ key: jwk, format: "jwk" });

      return {
        publicKey,
        keyId: key.id,
        keyVersion: key.properties?.version
      };
    })());
  }

  return _localWrapClientCache.get(cacheKey);
}

/**
 * Deterministic token via Key Vault sign (recommended algorithm: RS256 for deterministic signature).
 * - normalize input yourself (email/phone)
 * - returns a short token that you can hash again for rowKey.
 *
 * RBAC needed: `Microsoft.KeyVault/vaults/keys/sign/action` (and optionally verify).
 */
export async function makeDeterministicToken({ value, purpose = "pii", alg = "RS256", kvUrl, keyName, credential } = {}) {
  const cc = await getKvCryptoClient({ kvUrl, keyName, credential });
  const msgHash = createHash("sha256").update(`${purpose}|${value}`).digest(); // 32 bytes
  const sig = await cc.sign(alg, msgHash);
  // token is the signature bytes base64url-encoded (can be long; often you hash it for rowKey)
  return b64u(sig.result);
}

/**
 * Envelope encrypt a UTF-8 string with AES-256-GCM.
 * - Generates random 32-byte DEK and 12-byte IV.
 * - Encrypts DEK locally using the RSA public JWK fetched from Key Vault (RSA-OAEP-256 by default).
 *   Uses Node.js built-in `publicEncrypt` — no Azure SDK crypto call needed for this path.
 * - The envelope includes `kid` so you know which key version was used.
 *
 * RBAC needed: `Microsoft.KeyVault/vaults/keys/read` (Key Reader, public writer).
 */
export async function encryptPiiString({ plaintext, aad = "", wrapAlg = "RSA-OAEP-256", kvUrl, keyName, credential } = {}) {
  if (plaintext === null || plaintext === undefined) return null;

  const { publicKey, keyId } = await getLocalKvWrapClient({ kvUrl, keyName, credential });

  const dek = randomBytes(32);
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Encrypt DEK locally with the RSA public key using OAEP padding.
  const encryptedDek = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: oaepHashForAlg(wrapAlg) },
    dek
  );

  // Small JSON envelope; safe to store in Table Storage properties
  return {
    v: 1,
    enc: "A256GCM",
    iv: b64u(iv),
    ct: b64u(ct),
    tag: b64u(tag),
    aad: aad ? b64u(Buffer.from(String(aad), "utf8")) : "",
    wk: b64u(encryptedDek),
    wa: wrapAlg,
    kid: keyId
  };
}

/**
 * Decrypt envelope produced by encryptPiiString.
 *
 * RBAC needed: `Microsoft.KeyVault/vaults/keys/decrypt/action` (admin reader).
 */
export async function decryptPiiString({ envelope, aad = "", kvUrl, keyName, credential } = {}) {
  if (!envelope) return null;
  const cc = await getKvCryptoClient({ kvUrl, keyName, credential, keyId: envelope.kid });

  const iv = unb64u(envelope.iv);
  const ct = unb64u(envelope.ct);
  const tag = unb64u(envelope.tag);
  const encryptedKey = unb64u(envelope.wk);
  const wrapAlg = envelope.wa || "RSA-OAEP-256";

  // Decrypt the DEK via Key Vault (requires decrypt RBAC).
  const decrypted = await cc.decrypt(wrapAlg, encryptedKey);
  const dek = Buffer.from(decrypted.result);

  const decipher = createDecipheriv("aes-256-gcm", dek, iv);
  if (aad) decipher.setAAD(Buffer.from(String(aad), "utf8"));
  decipher.setAuthTag(tag);

  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Convenience: make a compact storage string (JSON -> base64url) and reverse.
 */
export function envelopeToString(envelope) {
  if (!envelope) return "";
  return b64u(Buffer.from(JSON.stringify(envelope), "utf8"));
}
export function envelopeFromString(s) {
  if (!s) return null;
  return JSON.parse(unb64u(s).toString("utf8"));
}
