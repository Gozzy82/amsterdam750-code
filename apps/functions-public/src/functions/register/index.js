import { app } from "@azure/functions";
import { isGuid } from "@gozzy82/amsterdam750-shared";
import { htmlRes } from "./responses.js";
import { parseBodyText, sha256Hex } from "./utils.js";
import { getOtpTable, getPhoneLockTable, getPreregTable } from "./database.js";
import { verifyOtp, requestOtp } from "./handlers.js";
import { verifyTurnstile } from "../preregister/lib/turnstile.js";

async function registerHandler(request, context) {
  try {
    const rawText = await request.text();
    const body = parseBodyText(rawText);
    const { token, phone, otp, "cf-turnstile-response": cfToken } = body || {};

    if (!token) return htmlRes(400, "<p class='error'>Token ontbreekt.</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
    if (!isGuid(token)) {
      return htmlRes(404, "<p class='error'>Uitnodiging niet gevonden of verlopen.</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
    }

    const isOtpVerification = otp !== undefined && otp !== "";
    if (!isOtpVerification) {
      const turnstileSecret = process.env.TURNSTILE_SECRET;
      if (!turnstileSecret) {
        context.log("register.turnstileNotConfigured");
        return htmlRes(500, "<p class='error'>Server niet geconfigureerd (verificatie).</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
      }
      if (!cfToken) {
        return htmlRes(400, "<p class='error'>Verificatie ontbreekt. Ververs de pagina en probeer het opnieuw.</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
      }
      if (!await verifyTurnstile(cfToken, turnstileSecret)) {
        return htmlRes(400, "<p class='error'>Verificatie mislukt. Ververs de pagina en probeer het opnieuw.</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
      }
    }

    const conn = process.env.TABLE_CONNECTION_STRING;
    if (!conn) return htmlRes(500, "<p class='error'>Server niet geconfigureerd (storage).</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });

    const otpTable = await getOtpTable(conn);
    const preregTable = await getPreregTable(conn);
    const phoneLockTable = await getPhoneLockTable(conn, process.env.PHONE_LOCK_TABLE_NAME || "PhoneLocks");
    const tokenHash = sha256Hex(token);
    const apiUrl = new URL(request.url).href;

    // STEP 2: Verify OTP
    if (isOtpVerification) {
      return await verifyOtp(otpTable, preregTable, tokenHash, token, otp, apiUrl, context);
    }

    // STEP 1: Request OTP
    return await requestOtp(otpTable, preregTable, phoneLockTable, token, phone, apiUrl, context);

  } catch (err) {
    context.log("register.error", err?.message);
    return htmlRes(500, "<p class='error'>Onverwachte fout, probeer later opnieuw.</p>", { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
  }
}

app.http("register", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "register",
  handler: registerHandler,
});
