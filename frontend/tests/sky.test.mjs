import test from 'node:test';
import assert from 'node:assert/strict';
import {skyPhase} from '../src/sky.ts';

test('el cielo sigue la hora de Madrid: día, tarde y noche', () => {
  // Noviembre: Madrid va una hora por delante de UTC.
  assert.equal(skyPhase(new Date('2026-11-23T05:59:00Z')), 'night'); // 6:59
  assert.equal(skyPhase(new Date('2026-11-23T06:00:00Z')), 'day'); // 7:00
  assert.equal(skyPhase(new Date('2026-11-23T15:59:00Z')), 'day'); // 16:59
  assert.equal(skyPhase(new Date('2026-11-23T16:00:00Z')), 'afternoon'); // 17:00
  assert.equal(skyPhase(new Date('2026-11-23T19:00:00Z')), 'night'); // 20:00
  // Verano: dos horas por delante.
  assert.equal(skyPhase(new Date('2026-07-01T15:30:00Z')), 'afternoon'); // 17:30
});
