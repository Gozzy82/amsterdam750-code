const _public = 'http://localhost:7071';

window.APP_CONFIG = {
  apiPreregister: `${_public}/api/preregister`,
  apiRegister: `${_public}/api/register`,
  apiStatus: `${_public}/api/status`,
  // Cloudflare always-pass test key — safe for local dev and load tests.
  // Replace with the real sitekey in production config.
  turnstileSitekey: '1x00000000000000000000AA',
};
