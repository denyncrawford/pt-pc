import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameMetrics } from '../src/modules/renderer/gpu-resources';
test('frame metrics retain stalls, exclude paused gaps and bound memory', () => {
  const metrics = new FrameMetrics(2);
  metrics.begin(0, true, 'f040:active');
  metrics.end(1);
  metrics.begin(16, true, 'f040:active');
  metrics.end(2);
  metrics.begin(136, true, 'f040:active');
  metrics.end(90);
  assert.equal(metrics.snapshot()[0].over100Ms, 1);
  metrics.begin(150, false, 'f040:active');
  metrics.end(1);
  metrics.begin(10000, true, 'f040:active');
  metrics.end(1);
  assert.equal(metrics.snapshot()[0].frames, 2);
  metrics.begin(10016, true, 'f040:sequence');
  metrics.end(4);
  assert.equal(
    metrics.snapshot().reduce((n, group) => n + group.frames, 0),
    2,
  );
  assert.equal(metrics.snapshot()[0].worstMs, 16);
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), []);
});
