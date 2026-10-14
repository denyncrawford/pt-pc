import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subliminal } from '../src/modules/effects/subliminal';

test('original photo envelope displays text, two noise pulses and respects pause/reset', () => {
  const effect = new Subliminal();
  effect.trigger(32, () => 0.25);
  assert.equal(effect.image, 2);
  assert.deepEqual(effect.position, [0.25, 0.25]);
  effect.update(1 / 60);
  assert.equal(effect.text.value, 1);
  assert.equal(effect.noise.value, 1);
  const phase = effect.phase;
  effect.update(0);
  assert.equal(effect.phase, phase);
  effect.update(0.2);
  assert.equal(effect.noise.value, 0);
  assert.equal(effect.text.value, 1);
  let closingPulse = false;
  for (let i = 0; i < 210; i++) {
    effect.update(1 / 60);
    closingPulse ||= effect.noise.value > 0;
  }
  assert.ok(closingPulse);
  assert.equal(effect.text.value, 0);
  assert.equal(effect.noise.value, 0);
  effect.trigger(256);
  assert.equal(effect.image, 1);
  effect.reset();
  effect.update(0.1);
  assert.equal(effect.text.value, 0);
  assert.equal(effect.noise.value, 0);
});
