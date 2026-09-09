import { escapeHtml } from "./utils.js";

export function htmlRes(status, body, extraHeaders = {}) {
  return {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Expose-Headers": "HX-Location, HX-Push-Url, HX-Redirect, HX-Refresh, HX-Replace-Url, HX-Reselect, HX-Reswap, HX-Retarget, HX-Trigger, HX-Trigger-After-Settle, HX-Trigger-After-Swap",
        ...extraHeaders },
    body,
  };
}

export function otpFormHtml(apiUrl, token, maskedPhone) {
  return `<form id="verification-form"
    hx-post="${escapeHtml(apiUrl)}"
    hx-trigger="submit"
  >
    <input type="hidden" name="token" value="${escapeHtml(token)}" />
    <p>We hebben een code gestuurd naar <strong>${escapeHtml(maskedPhone)}</strong>. Voer de code in die je per SMS hebt ontvangen.</p>
    <label for="otp-1">Verificatiecode</label>
    <div class="otp-code-input" role="group" aria-label="Verificatiecode van zes cijfers">
      <input class="otp-code-group" id="otp-1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="one-time-code" aria-label="Eerste twee cijfers" />
      <span class="otp-separator" aria-hidden="true">-</span>
      <input class="otp-code-group" id="otp-2" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="Middelste twee cijfers" />
      <span class="otp-separator" aria-hidden="true">-</span>
      <input class="otp-code-group" id="otp-3" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="Laatste twee cijfers" />
    </div>
    <input id="otp" type="hidden" name="otp" required />
    <div id="otp-verification-error" role="alert" aria-live="polite"></div>
    <button id="otp-submit" type="submit" disabled>Verifieer code</button>
  </form>`;
}

export function buildWelcomeEmailHtml(firstName) {
  const safeFirstName = escapeHtml(firstName);
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><title>Welkom bij Amsterdam 750</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="color:#c00">Amsterdam 750 jaar</h1>
  <p>Beste ${safeFirstName},</p>
  <p>
    Geweldig! Je bent succesvol geregistreerd voor het Amsterdam 750-jaar evenement. 🎉
  </p>
  <p>
    Je plek is gereserveerd. Zorg ervoor dat je op de hoogte blijft van alle updates door regelmatig je e-mail te checken.
  </p>
  <p>
    We kijken ernaar uit om je te zien!
  </p>
  <hr style="margin-top:40px">
  <p style="font-size:12px;color:#666">
    Je ontvangt dit bericht omdat je je hebt geregistreerd voor Amsterdam 750.
    Als je dit niet herkent, kun je dit bericht negeren.
  </p>
</body>
</html>`;
}
