import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeExternalUrl, isTrustedFrame } from '../src/main/security.ts';

test('only opens explicit HTTP and HTTPS links without embedded credentials', () => {
  assert.equal(isSafeExternalUrl('https://example.com/path?q=1'), true);
  assert.equal(isSafeExternalUrl('http://localhost:3000'), true);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'https://user:pass@example.com', 'not a url']) {
    assert.equal(isSafeExternalUrl(url), false);
  }
});

test('accepts only the app document in its owning main frame', () => {
  assert.equal(isTrustedFrame('file:///app/index.html', 'file:///app/index.html', true), true);
  assert.equal(isTrustedFrame('file:///app/index.html', 'file:///app/index.html', false), false);
  assert.equal(isTrustedFrame('https://attacker.test', 'file:///app/index.html', true), false);
  assert.equal(isTrustedFrame('file:///app/other.html', 'file:///app/index.html', true), false);
});
