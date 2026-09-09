import { createHash } from "crypto";

export function sha256Hex(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseBodyText(text) {
  const s = (text || "").trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* empty */ }
  try {
    const params = new URLSearchParams(s);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    if (Object.keys(obj).length) return obj;
  } catch { /* empty */ }
  return {};
}
