import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadDemoResources } from '../src/modules/sequences/demo-resources';
import { SequenceClock, SequencePlayer } from '../src/modules/sequences/sequence-player';

test(
  'bathroom scare samples original light tracks and releases its sequence',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create();
    const resources = await loadDemoResources(w, Bun.file(process.env.PT_TEST_PSARC!));
    const meta = resources.metadata.get('gc_p01_021');
    const player = new SequencePlayer(
      w,
      resources.read(meta.demoStreamPath),
      'gc_p01_021',
      new SequenceClock(),
    );
    try {
      const samples = [0, 20, 35, 50, 70, 175].map((frame) =>
        player.use(() => {
          const count = w._sequence_lights(frame, 0);
          return Array.from({ length: count }, (_, i) => {
            const ptr = w._sequence_light_data(i) / 4;
            return [...w.HEAPF32.slice(ptr, ptr + 28)];
          });
        }),
      );
      assert.equal(samples[0].length, 3);
      assert.ok(samples.flat(2).every(Number.isFinite));
      assert.ok(
        samples.some((lights) => lights.some((light) => light[18] > 1)),
        'native light pulse is present',
      );
      assert.notDeepEqual(samples[0], samples[3], 'animated lights change during scare');
    } finally {
      player.destroy();
    }
    assert.equal(w._sequence_instance_count(), 0);
  },
);
