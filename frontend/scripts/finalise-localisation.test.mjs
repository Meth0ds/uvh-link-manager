import test from 'node:test';
import assert from 'node:assert/strict';
import { finaliseDocument } from './finalise-localisation.mjs';

const shell = '<html lang="en-GB"><head><title>Título español</title><meta name="description" content="Español"></head><body><app-root>Existing public content</app-root><noscript>Español</noscript></body></html>';

test('localises the private no-script shell and prevents indexing', () => {
  const html = finaliseDocument(shell, 'en');
  assert.ok(html.includes('Enable JavaScript'));
  assert.ok(html.includes('href="/en/help"'));
  assert.ok(html.includes('noindex, nofollow'));
  assert.ok(!html.includes('Español'));
});

test('public prerendered content remains readable without a redundant JavaScript notice', () => {
  const html = finaliseDocument(shell, 'en', { publicPage: true });
  assert.ok(html.includes('<app-root>Existing public content</app-root>'));
  assert.ok(!html.includes('<noscript>'));
});

test('refuses unsupported or mismatched locale documents', () => {
  assert.throws(() => finaliseDocument(shell, '../../en'), /Unsupported/);
  assert.throws(() => finaliseDocument(shell, 'es'), /mismatch/);
});
