import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, withString } from '../src/modules/gameplay/runtime';
import { prepareEffects } from '../src/modules/effects/effects';
test(
  'all 13 original locator effects compile and simulate in WASM with model and flare dependencies',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC),
      scene = await loadHallway(w, file, () => {}, { scripts: true });
    const p = w._malloc(31 * 4),
      matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const view = [0, 0, 3, 0, 0, -1, 0, 1, 0, 1, 0, 0, ...matrix, 16 / 9, 1, 0.05];
    let totals = [];
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const prepared = await prepareEffects(w, scene, file);
        assert.equal(prepared.manifests.size, 13);
        let shapes = 0;
        for (const [path, m] of prepared.manifests) {
          shapes += m.shapes.length;
          assert.deepEqual(m.unsupported, []);
        }
        const stats = [];
        let id = 0;
        for (const [path, m] of prepared.manifests) {
          w.HEAPF32.set(matrix, p / 4);
          assert.equal(
            withString(w, path, (k: any) => w._vfx_spawn(id, k, p, 1234)),
            1,
            path,
          );
          let particles = 0,
            quads = 0,
            lights = 0;
          for (let tick = 0; tick < 120; tick++) {
            w.HEAPF32.set(view, p / 4);
            assert.equal(w._vfx_tick(1 / 60, p), 1);
            const q = w._vfx_quad_data() / 4;
            for (let i = 0; i < w._vfx_quad_count(); i++)
              for (let j = 0; j < 76; j++)
                if (j < 40 || j >= 44)
                  assert.ok(Number.isFinite(w.HEAPF32[q + i * 76 + j]), path + ' finite quad');
            particles = Math.max(particles, w._vfx_particles());
            quads = Math.max(quads, w._vfx_quad_count());
            lights = Math.max(lights, w._vfx_light_count());
          }
          assert.ok(particles > 0 || m.flares.length > 0, path + ' emits');
          stats.push({ path, particles, quads, lights });
          w._vfx_remove(id++);
          assert.equal(w._vfx_instances(), 0);
          assert.equal(w._vfx_particles(), 0);
        }
        totals.push(stats);
        prepared.destroy();
        assert.equal(w._vfx_texture_count(), 0);
        assert.equal(w._vfx_quad_count(), 0);
        console.log('VFX cycle', cycle, shapes, 'shapes', JSON.stringify(stats));
      }
      assert.deepEqual(totals[1], totals[0], 'seeded simulation repeats after release');
      assert.deepEqual(totals[2], totals[0]);
    } finally {
      w._free(p);
      w._vfx_reset();
    }
  },
);
