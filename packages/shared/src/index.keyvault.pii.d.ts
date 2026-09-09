import type { CryptographyClient } from '@azure/keyvault-keys';
import type { KeyObject } from 'crypto';
import type { TokenCredential } from '@azure/identity';

export interface KvOptions {
  kvUrl?: string;
  keyName?: string;
  credential?: TokenCredential;
  keyId?: string;
}

export function sha256Hex(input: string): string;

export function getKvCryptoClient(options?: KvOptions): Promise<CryptographyClient>;

export interface LocalWrapClient {
  /** Node.js RSA public key for local encryption (no Azure SDK crypto call). */
  publicKey: KeyObject;
  keyId: string | undefined;
  keyVersion: string | undefined;
}

export function getLocalKvWrapClient(options?: KvOptions): Promise<LocalWrapClient>;

export interface DeterministicTokenOptions extends KvOptions {
  value: string;
  purpose?: string;
  alg?: string;
}
export function makeDeterministicToken(options: DeterministicTokenOptions): Promise<string>;

export interface PiiEnvelope {
  v: number;
  enc: string;
  iv: string;
  ct: string;
  tag: string;
  aad: string;
  wk: string;
  wa: string;
  kid?: string;
}

export interface EncryptOptions extends KvOptions {
  plaintext: string | null | undefined;
  aad?: string;
  wrapAlg?: string;
}
export function encryptPiiString(options: EncryptOptions): Promise<PiiEnvelope | null>;

export interface DecryptOptions extends KvOptions {
  envelope: PiiEnvelope | null | undefined;
  aad?: string;
}
export function decryptPiiString(options: DecryptOptions): Promise<string | null>;

export function envelopeToString(envelope: PiiEnvelope | null | undefined): string;
export function envelopeFromString(s: string | null | undefined): PiiEnvelope | null;
