import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'apps/web/public/preregister/index.html'), 'utf8');
const script = readFileSync(resolve(process.cwd(), 'apps/web/public/preregister/form-validation.js'), 'utf8');
const staticWebAppConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/web/public/staticwebapp.config.json'), 'utf8'));

test('preregister page moves styling to the shared external stylesheet', () => {
  assert.doesNotMatch(html, /document\.write/);
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/style\.css" \/>/);
  assert.match(html, /<script src="\.\.\/config\.js" defer><\/script>/);
  assert.doesNotMatch(html, /window\.APP_CONFIG = Object\.assign/);
});

test('preregister page defers htmx loading', () => {
  assert.match(html, /<script src="\.\.\/vendor\/htmx\/htmx\.min\.js" defer><\/script>/);
  assert.match(html, /<script src="\.\.\/vendor\/htmx\/ext\/json-enc\.js" defer><\/script>/);
});

test('preregister page loads the Cloudflare Turnstile script explicitly', () => {
  assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" defer><\/script>/);
});

test('preregister page includes meta description', () => {
  assert.match(html, /<meta name="description" content="Pre-registreer je ticket voor Amsterdam 750[^"]*" \/>/);
});

test('preregister page initializes Turnstile on page load as always-on invisible widget', () => {
  assert.match(script, /_initTurnstile/);
  assert.match(script, /window\.turnstile\.render/);
  assert.match(script, /appearance.*interaction-only|interaction-only.*appearance/);
  assert.doesNotMatch(script, /onTurnstileLoad/);
});

test('preregister page injects Turnstile token via htmx:configRequest', () => {
  assert.match(script, /htmx:configRequest/);
  assert.match(script, /cf-turnstile-response/);
});

test('preregister page renders consent errors below the consent field', () => {
  assert.match(script, /closest\('\.consent-field'\)\s*\|\|\s*el\.closest\('label'\)/);
  assert.match(script, /Je moet toestemming geven om door te gaan/);
});

test('preregister page resets Turnstile widget after each request', () => {
  assert.match(script, /_resetTurnstile/);
  assert.match(script, /turnstile\.reset/);
});

test('preregister page reports clear messages when Turnstile is unavailable', () => {
  assert.match(script, /TURNSTILE_SITEKEY ontbreekt/);
  assert.match(script, /Turnstile laadt niet/);
  assert.match(script, /De knop Versturen blijft grijs totdat Turnstile een token levert/);
});

test('preregister page explains when its domain is not allowed by Turnstile', () => {
  assert.match(script, /\['110200', '400020'\]\.includes\(String\(errorCode\)\)/);
  assert.match(script, /dit webadres niet goed is ingesteld in Cloudflare Turnstile/);
  assert.match(script, /_reportTurnstileIssue/);
});

test('preregister page makes Turnstile errors visible despite the default server error styling', () => {
  assert.match(script, /errorContainer\.hidden = false/);
  assert.match(script, /errorContainer\.style\.display = 'block'/);
});

test('static web app CSP allows the Cloudflare Turnstile assets it needs', () => {
  const csp = staticWebAppConfig.globalHeaders['Content-Security-Policy'];
  assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /script-src[^;]*blob:/);
  assert.match(csp, /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});
