import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'apps/web/public/register/index.html'), 'utf8');
const script = readFileSync(resolve(process.cwd(), 'apps/web/public/register/register.js'), 'utf8');

test('register page loads external register script', () => {
  assert.match(html, /<script src="\.\/register\.js" defer><\/script>/);
});

test('register page moves styling to the shared external stylesheet', () => {
  assert.doesNotMatch(html, /document\.write/);
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/style\.css" \/>/);
  assert.match(html, /<script src="\.\.\/config\.js" defer><\/script>/);
  assert.doesNotMatch(html, /window\.APP_CONFIG = Object\.assign/);
});

test('register page defers htmx loading', () => {
  assert.match(html, /<script src="\.\.\/vendor\/htmx\/htmx\.min\.js" defer><\/script>/);
});

test('register page protects the sms request with Cloudflare Turnstile', () => {
  assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" defer><\/script>/);
  assert.match(html, /<div id="turnstile-widget"><\/div>/);
  assert.match(script, /window\.turnstile\.render/);
  assert.match(script, /cf-turnstile-response/);
  assert.match(script, /htmx:configRequest/);
  assert.match(script, /resetTurnstile/);
});

test('register page includes meta description', () => {
  assert.match(html, /<meta name="description" content="Rond je registratie af voor Amsterdam 750[^"]*" \/>/);
});

test('register page includes HTMX error swap guard for non-2xx responses', () => {
  assert.match(script, /htmx:beforeSwap/);
  assert.match(script, /verification-form/);
  assert.match(script, /evt\.detail\.shouldSwap\s*=\s*true/);
  assert.match(script, /evt\.detail\.isError\s*=\s*false/);
  assert.match(script, /evt\.detail\.target\s*=\s*result/);
});

test('register page includes transport-level fallback message', () => {
  assert.match(script, /htmx:sendError/);
  assert.match(script, /Verbinding met de server mislukt/);
});

test('register page toggles server-error class correctly for error/success responses', () => {
  assert.match(script, /result\.classList\.add\('server-error'\)/);
  assert.match(script, /xhr\.status\s*<\s*400\)\s*result\.classList\.remove\('server-error'\)/);
});

test('register page shows immediate sms sending feedback and disables duplicate submits', () => {
  assert.match(script, /setSubmittingState/);
  assert.match(script, /Even geduld\.\.\./);
  assert.match(script, /we verwerken je aanvraag/i);
  assert.match(script, /document\.body\.addEventListener\('submit'/);
  assert.match(script, /document\.body\.addEventListener\('htmx:beforeRequest'/);
  assert.match(script, /document\.body\.addEventListener\('htmx:afterRequest'/);
});

test('register page reloads when the verification code is expired or invalidated', () => {
  assert.match(script, /getReloadAfterMs/);
  assert.match(script, /querySelector\('\[data-reload-after-ms\]'\)/);
  assert.match(script, /getAttribute\('data-reload-after-ms'\)/);
  assert.match(script, /Number\.parseInt/);
  assert.match(script, /window\.setTimeout\(/);
  assert.match(script, /location\.reload\(\)/);
});
