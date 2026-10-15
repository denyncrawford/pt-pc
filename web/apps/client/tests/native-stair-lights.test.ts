import test from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway } from '../src/modules/gameplay/runtime';

test(
  'f040 stair spotlights retain the native 40-lumen override in ID60',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create();
    await loadHallway(w, Bun.file(process.env.PT_TEST_PSARC!), () => {}, {
      scripts: true,
      checkpoint: { floor: 'f040', photoWord: 1 },
    });
    const found = new Set<string>();
    for (let i = 0; i < w._light_count(); i++) {
      const name = w.UTF8ToString(w._light_name(i));
      if (!name.includes('|pt14_hallway_light_ID60|')) continue;
      const leaf = name.split('|').at(-1)!;
      const ptr = w._light_data(i) / 4;
      if (leaf === '8SL_stairs_down0000' || leaf === '8SL_stairs_down0002') {
        assert.equal(w.HEAPF32[ptr + 18], 40, leaf);
        // Native temperature/solid-angle conversion with the overridden flux.
        assert.ok(Math.abs(w.HEAPF32[ptr + 4] - 2.5109901428222656) < 1e-5);
        found.add(leaf);
      }
      if (leaf === '7PL_wall0002') assert.equal(w.HEAPF32[ptr + 18], 200);
    }
    assert.equal(found.size, 2);
  },
);
