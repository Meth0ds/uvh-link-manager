import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalisation, sourceFingerprint } from './localisation-integrity.mjs';

const sourceMessage = 'Hola <ph id="0" equiv="NAME"/>';
const xml = (body, target = false) => `<?xml version="1.0"?><xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="es"${target ? ' trgLang="en-GB"' : ''}><file id="ngi18n">${body}</file></xliff>`;
const unit = (translation = null) => `<unit id="greeting"><segment><source>${sourceMessage}</source>${translation === null ? '' : `<target>${translation}</target>`}</segment></unit>`;
const memory = { greeting: { sourceHash: sourceFingerprint('Hola ⟦0⟧'), text: 'Hello ⟦0⟧' } };

test('accepts authored copy with unchanged interpolation', () => {
  assert.deepEqual(validateLocalisation(xml(unit()), xml(unit('Hello <ph id="0" equiv="NAME"/>'), true), memory), []);
});
test('rejects missing translations and unapproved copy', () => {
  assert.ok(validateLocalisation(xml(unit()), xml(unit(), true), memory).some(error => error.includes('Missing target')));
  assert.ok(validateLocalisation(xml(unit()), xml(unit('Hello <ph id="0" equiv="NAME"/>'), true), {}).some(error => error.includes('Missing approved copy')));
});
test('rejects dropped or changed placeholders', () => {
  for (const translation of ['Hello', 'Hello <ph id="0" equiv="PASSWORD"/>']) {
    assert.ok(validateLocalisation(xml(unit()), xml(unit(translation), true), memory).some(error => error.includes('Placeholder mismatch')));
  }
});
test('rejects incompatible duplicate ids and unexpected HTML', () => {
  assert.ok(validateLocalisation(xml(unit() + unit()), xml(unit('Hello <ph id="0" equiv="NAME"/>'), true), memory).some(error => error.includes('duplicate message id')));
  assert.ok(validateLocalisation(xml(unit()), xml(unit('<script>alert(1)</script>'), true), memory).some(error => error.includes('Unexpected translation markup')));
});
