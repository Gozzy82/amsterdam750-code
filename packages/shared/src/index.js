import {phone} from 'phone';
import normalizedEmail from "normalize-email";
import { randomInt } from 'crypto';

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeEmail(email) {
  return normalizedEmail(email);
}

export function normalizePhone(s){
    const result = phone(s);
    return result.isValid ? result.phoneNumber : null;
}

export function isGuid(value) {
  if (typeof value !== "string") return false;
  return GUID_REGEX.test(value.trim());
}


export function nowIso() {
  return new Date().toISOString();
}

function randomDigit() {
  return randomInt(0, 10).toString();
}

export function generateMemorableCode() {
  // Intentionally use a memorable 6-digit pattern for SMS UX.
  // This code is read by a person from a single SMS, expires quickly, and has a
  // very low attempt limit, so memorability is preferred over the full 1,000,000-space.
  const a = randomDigit();
  const b = randomDigit();
  const c = randomDigit();
  const d = randomDigit();

  const patterns = [
    `${a}${b}${c}${d}${a}${b}`, // AB-CD-AB
    `${a}${b}${a}${b}${c}${d}`, // AB-AB-CD
    `${a}${b}${c}${d}${d}${c}`, // AB-CD-DC
    `${a}${b}${c}${d}${b}${a}`, // AB-CD-BA
  ];

  return patterns[randomInt(0, patterns.length)];
}

export function formatCode(code) {
  return code.replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3");
}

export * from "./index.keyvault.pii.js";
