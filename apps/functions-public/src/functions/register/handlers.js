import { normalizePhone, generateMemorableCode, formatCode } from "@gozzy82/amsterdam750-shared";
import { htmlRes, otpFormHtml } from "./responses.js";
import { sha256Hex } from "./utils.js";
import {
  getUserEntity,
  getPhoneHashForUser,
  getOtpEntity,
  storeOtpCode,
  claimOtpAttempt,
  deleteOtpCode,
  markUserAsVerified,
} from "./database.js";
import { sendOtpViaSms } from "./communications.js";

const OTP_TTL_SECONDS = 1800;   // 30 minutes
const OTP_MAX_ATTEMPTS = 3;     // max verification attempts per OTP
const SMS_MAX_REQUESTS = 3;     // max SMS requests before lockout
const SMS_LOCKOUT_HOURS = 12;   // lockout duration in hours
const OTP_RELOAD_DELAY_SECONDS = 5;
const OTP_RELOAD_DELAY_MS = OTP_RELOAD_DELAY_SECONDS * 1000;

const forceReloadErrorHtml = (message) => (
  `<p class='error' role='alert' data-reload-after-ms='${OTP_RELOAD_DELAY_MS}'>${message}</p>`
);

const expiredOtpHtml = forceReloadErrorHtml(
  `Verificatiecode verlopen. Vraag een nieuwe code aan. De pagina wordt over ${OTP_RELOAD_DELAY_SECONDS} seconden opnieuw geladen.`
);
const invalidatedOtpHtml = forceReloadErrorHtml(
  `Te veel pogingen. De code is ongeldig gemaakt. De pagina wordt over ${OTP_RELOAD_DELAY_SECONDS} seconden opnieuw geladen om het opnieuw te proberen.`
);

export async function verifyOtp(otpTable, preregTable, tokenHash, token, otp, apiUrl, context) {
  const otpCode = String(otp).trim().replace(/\D/g, '');
  const attemptClaim = await claimOtpAttempt(otpTable, tokenHash, OTP_MAX_ATTEMPTS);

  if (attemptClaim.status === "notFound") {
    const tokenRef = tokenHash.slice(0, 8);
    context.log("register.otp.verify.not_found", { tokenRef });
    return htmlRes(422,
      expiredOtpHtml,
      { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
  }

  const otpEntity = attemptClaim.otpEntity;
  const tokenRef = tokenHash.slice(0, 8);

  if (attemptClaim.status === "limitReached") {
    await deleteOtpCode(otpTable, otpEntity);
    context.log("register.otp.verify.locked", { tokenRef, attempts: otpEntity.attempts || 0 });
    return htmlRes(429,
      invalidatedOtpHtml,
      { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
  }

  const ageSeconds = (Date.now() - new Date(otpEntity.createdAt).getTime()) / 1000;
  
  if (ageSeconds > OTP_TTL_SECONDS) {
    await deleteOtpCode(otpTable, otpEntity);
    context.log("register.otp.verify.expired", { tokenRef, ageSeconds: Math.floor(ageSeconds) });
    return htmlRes(422,
      expiredOtpHtml,
      { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
  }

  const attempts = attemptClaim.attempts;

  // Intentionally keep this as a plain string comparison.
  // This OTP is short-lived, rate-limited, and only allows a few attempts, so
  // timingSafeEqual adds complexity without meaningful security benefit here.
  if (otpEntity.code !== otpCode) {
    const remaining = OTP_MAX_ATTEMPTS - attempts;
    if (remaining <= 0) {
      await deleteOtpCode(otpTable, otpEntity);
      context.log("register.otp.verify.locked", { tokenRef, attempts });
      return htmlRes(429,
        invalidatedOtpHtml,
        { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
    }

    context.log("register.otp.verify.mismatch", { tokenRef, attempts, remaining });
    return htmlRes(422,
      `<p class='error' role='alert'>Verkeerde code. Nog ${remaining} ${remaining === 1 ? "poging" : "pogingen"} over.</p>`,
      { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
  }

  // ✓ OTP correct
  await deleteOtpCode(otpTable, otpEntity);
  context.log("register.otp.verify.success", { tokenRef });

  const verifiedUserEntity = await getUserEntity(preregTable, token);
  if (!verifiedUserEntity) {
    return htmlRes(404, "<p class='error'>Uitnodiging niet gevonden of verlopen.</p>", { "HX-Retarget": "#otp-verification-error", "HX-Reswap": "innerHTML" });
  }

  await markUserAsVerified(preregTable, verifiedUserEntity);

  return htmlRes(200,
    "<p class='success' role='status'><strong>Welkom! 🎉</strong> Je bent succesvol geregistreerd voor Amsterdam 750.</p>",
    { "HX-Retarget": "#verification-form", "HX-Reswap": "innerHTML" });
}

export async function requestOtp(otpTable, preregTable, phoneLockTable, token, phone, apiUrl, context) {
  if (!phone) return htmlRes(400, "<p class='error'>Telefoonnummer is verplicht.</p>",  { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return htmlRes(422, "<p class='error'>Telefoonnummer is ongeldig.</p>",  { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
  }

  const userEntity = await getUserEntity(preregTable, token);
  if (!userEntity) {
    return htmlRes(404, "<p class='error'>Uitnodiging niet gevonden of verlopen.</p>",  { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
  }

  const expectedPhoneHash = userEntity.phoneHash || await getPhoneHashForUser(phoneLockTable, userEntity.rowKey);
  if (!expectedPhoneHash) {
    context.log("register.otp.request.phone_hash_missing", { userRowKey: userEntity.rowKey });
    return htmlRes(500,
      "<p class='error'>Registratie kan momenteel niet worden geverifieerd. Probeer later opnieuw.</p>",
      { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
  }

  if (sha256Hex(normalizedPhone) !== expectedPhoneHash) {
    return htmlRes(422, "<p class='error'>Het telefoonnummer komt niet overeen met de pre-registratie.</p>",
      {
    "HX-Retarget": "#verification-error",
    "HX-Reswap": "innerHTML",
  }
    );
  }

  const tokenHash = sha256Hex(token);
  const tokenRef = tokenHash.slice(0, 8);
  const maskedPhone = normalizedPhone.slice(0, 4) + "****" + normalizedPhone.slice(-3);

  // Check for SMS rate limiting
  const existingOtp = await getOtpEntity(otpTable, tokenHash);
  
  if (existingOtp) {
    const smsSentCount = existingOtp.smsSentCount || 0;
    const lastSmsSentAt = existingOtp.lastSmsSentAt ? new Date(existingOtp.lastSmsSentAt).getTime() : 0;
    const now = Date.now();
    const lockoutMs = SMS_LOCKOUT_HOURS * 60 * 60 * 1000;
    const timeSinceLastSms = now - lastSmsSentAt;

    if (smsSentCount >= SMS_MAX_REQUESTS) {
      if (timeSinceLastSms < lockoutMs) {
        // Still in lockout period
        const remainingMs = lockoutMs - timeSinceLastSms;
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
        context.log("register.otp.request.rate_limited", { tokenRef, smsSentCount, remainingHours });
        return htmlRes(429,
          `<p class='error' role='alert'>Te veel verzoeken voor verificatiecode. Probeer over ${remainingHours} ${remainingHours === 1 ? "uur" : "uur"} opnieuw.</p>`,
          { "HX-Retarget": "#verification-error", "HX-Reswap": "innerHTML" });
      } else {
        // Lockout period expired, reset counter
        context.log("register.otp.request.lockout_expired", { tokenRef, smsSentCount });
      }
    }
  }

  // Generate memorable code and send SMS
  const code = generateMemorableCode();
  const formattedCode = formatCode(code);

  // Calculate new SMS sent count
  const newSmsSentCount = existingOtp && (existingOtp.smsSentCount || 0) < SMS_MAX_REQUESTS 
    ? (existingOtp.smsSentCount || 0) + 1
    : 1;

  await storeOtpCode(otpTable, tokenHash, code, maskedPhone, newSmsSentCount);
  await sendOtpViaSms(normalizedPhone, formattedCode);
  context.log("register.otp.sent", { maskedPhone, smsSentCount: newSmsSentCount });
  
  return htmlRes(200, otpFormHtml(apiUrl, token, maskedPhone), {
    "HX-Retarget": "#registerForm",
    "HX-Reswap": "outerHTML",
  });
}
