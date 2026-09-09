/**
 * Build the out-of-band htmx HTML snippet that renders an invisible Cloudflare Turnstile widget.
 * On a successful challenge the token is injected into the form and the form is re-submitted.
 * @param {string} sitekey - Cloudflare Turnstile site key
 * @returns {string} HTML string targeting `#turnstile-notice` via `hx-swap-oob`
 */
export function challengeHtmlInvisible(sitekey) {
  return `
    <div id="turnstile-notice" hx-swap-oob="true">
      <p id="robot-check">Even checken of je geen robot bent…</p>
      <div id="widget-container" data-turnstile-sitekey="${sitekey}"></div>
    </div>
  `;
}

/**
 * Verify a Cloudflare Turnstile client-side token against the siteverify API.
 * @param {string} token - Token returned by the Turnstile widget callback
 * @param {string} secret - Cloudflare Turnstile secret key
 * @returns {Promise<boolean>} `true` if the token is valid, `false` otherwise
 */
export async function verifyTurnstile(token, secret) {
  if (!token || !secret) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    return !!(await r.json()).success;
  } catch {
    return false;
  }
}
