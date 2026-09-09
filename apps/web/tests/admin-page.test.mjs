import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'apps/web/public/admin/index.html'), 'utf8');

test('admin page loads a dedicated admin config file', () => {
  assert.match(html, /<script src="\.\.\/config\.admin\.js"><\/script>/);
});

test('admin page loads the external dashboard script', () => {
  assert.match(html, /<script src="\.\/admin\.js" defer><\/script>/);
});

test('admin page no longer uses document.write for config selection', () => {
  assert.doesNotMatch(html, /document\.write/);
  assert.doesNotMatch(html, /<script>\s*const USE_MSAL/s);
});
