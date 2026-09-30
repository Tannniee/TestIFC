import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapboxToken } from '../src/lib/mapbox-token.ts';
test('Mapbox settings accept only public tokens and support deletion', () => {
  assert.equal(normalizeMapboxToken(' pk.public_test-1 '), 'pk.public_test-1');
  for (const value of ['', null, 1, 'sk.private', 'pk.bad token', 'pk.' + 'a'.repeat(2048)]) {
    assert.equal(normalizeMapboxToken(value), '');
  }
});
