import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowMatrix } from '../src/modules/renderer/lighting';
test('spot shadow projection clips fixture inside authored inner range', () => {
  const light = new Float32Array(28);
  light[3] = 10;
  light[9] = -1;
  light[11] = 0.01;
  light[14] = 0.5;
  light[23] = Math.cos(Math.PI / 3);
  const m = shadowMatrix(light, 0);
  const project = (p: number[]) => {
    const q = [0, 1, 2, 3].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
    return q.map((v) => v / q[3]);
  };
  assert.ok(
    project([0, -0.1, 0])[2] < 0,
    'lamp housing before near plane cannot cast enlarged shadows',
  );
  assert.ok(
    project([0, -2, 0])[2] > 0 && project([0, -2, 0])[2] < 1,
    'room remains in shadow frustum',
  );
  assert.deepEqual(shadowMatrix(light, 5), m, 'spot uses one directed frustum, never cube faces');
  assert.ok(Math.abs(project([0, -0.5, 0])[2]) < 1e-6);
});
