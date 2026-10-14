// Optional integration test against the user's local copy. No game data in the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
test(
  'local hallway: original FOX2/GEOM, floor, both walls, corner, stairs and exit door',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const handle = await open(process.env.PT_TEST_PSARC, 'r');
    try {
      const { size } = await handle.stat();
      const file = {
        size,
        slice: (a: any, b: any) => ({
          arrayBuffer: async () => {
            const bytes = new Uint8Array(b - a);
            let n = 0;
            while (n < bytes.length) {
              const r = await handle.read(bytes, n, bytes.length - n, a + n);
              if (!r.bytesRead) throw Error('Unexpected EOF');
              n += r.bytesRead;
            }
            return bytes.buffer;
          },
        }),
      };
      const w = await create({
        wasmBinary: readFileSync(
          new URL('../../../packages/engine-wasm/dist/geometry.wasm', import.meta.url),
        ),
      });
      const scene = await loadHallway(w, file);
      assert.equal(scene.probes.length, 63);
      assert.equal(scene.probes.filter((p: any) => p.dark).length, 3);
      assert.ok(scene.probes.every((p: any) => p.data.every(Number.isFinite)));
      assert.ok(
        scene.probes
          .filter((p: any) => p.dark)
          .every((p: any) => p.data.slice(24).every((v: any) => v === 0)),
      );
      assert.ok(scene.mirrorPlane.every(Number.isFinite));
      assert.equal(scene.groups.filter((g: any) => g.mirror).length, 1);
      assert.equal(scene.lights.length, 38);
      assert.equal(scene.lights.filter((l: any) => l.data[15]).length, 10);
      assert.ok(scene.lights.every((l: any) => l.data.every(Number.isFinite)));
      assert.ok(scene.collisionCount > 1000);
      assert.ok(scene.vertices.length > 100000);
      const reset = () => w._player_spawn(...scene.spawn.position);
      function move(x: any, z: any, ticks: any) {
        let p;
        for (let i = 0; i < ticks; i++) p = stepPlayer(w, x / 300, z / 300);
        return [...p];
      }
      reset();
      let p = move(0, 0, 900);
      assert.ok(Math.abs(p[1] + 1.4) < 0.03);
      assert.equal(p[3], 1);
      p = move(2, 0, 1500);
      assert.ok(p[0] > 0.2 && p[0] < 0.4);
      reset();
      p = move(-2, 0, 1500);
      assert.ok(p[0] > -0.4 && p[0] < -0.2);
      reset();
      p = move(0, 2, 1890);
      assert.ok(p[2] > 7.4 && p[2] < 7.7);
      p = move(-2, 0, 1800);
      assert.ok(p[0] < -11.8 && p[0] > -12.2);
      assert.ok(Math.abs(p[1] + 1.4) < 0.03);
      p = move(-2, 0, 1800);
      assert.ok(p[0] < -15.8 && p[0] > -16.2);
      assert.ok(Math.abs(p[1] + 2.8) < 0.03);
      assert.equal(p[3], 1);
      const end = p[0];
      p = move(-2, 0, 1500);
      assert.ok(Math.abs(p[0] - end) < 0.05, 'closed original exit stops player');
      reset();
      p = move(0, -2, 900);
      assert.ok(p[2] > -6.2, 'closed original entry stops player');
      console.log(
        `Verified ${scene.collisionCount} original collision triangles, ${scene.indices.length / 3} render triangles`,
      );
    } finally {
      await handle.close();
    }
  },
);

test(
  'local first-loop exit: original trap direction, acknowledgement and Play message collision ownership',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const handle = await open(process.env.PT_TEST_PSARC, 'r');
    try {
      const { size } = await handle.stat(),
        file = {
          size,
          slice: (a: any, b: any) => ({
            arrayBuffer: async () => {
              const bytes = new Uint8Array(b - a);
              let n = 0;
              while (n < bytes.length) {
                const r = await handle.read(bytes, n, bytes.length - n, a + n);
                assert.ok(r.bytesRead);
                n += r.bytesRead;
              }
              return bytes.buffer;
            },
          }),
        };
      const w = await create({
          wasmBinary: readFileSync(
            new URL('../../../packages/engine-wasm/dist/geometry.wasm', import.meta.url),
          ),
        }),
        scene = await loadHallway(w, file);
      const exit = scene.placements.find((p: any) => p.name.endsWith('_hallway_out'));
      assert.ok(exit);
      const requests = (yaw: any) => {
        const n = w._events_tick(-15.75, -2.8, 7.5, yaw, -1, 0);
        return Array.from({ length: n }, (_: any, i: any) => ({
          i,
          target: w.UTF8ToString(w._event_target(i)),
          flag: w._event_flag(i),
        })).filter((e: any) => e.target === 'gc_p00_010');
      };
      w._events_reset();
      assert.equal(requests(Math.PI / 2).length, 0, 'facing away does not request opening');
      let r = requests(-Math.PI / 2);
      assert.equal(r.length, 1);
      assert.equal(r[0].flag, 1);
      assert.equal(requests(-Math.PI / 2).length, 0, 'inside does not replay an Enter demo');
      w._events_tick(-14, -2.8, 7.5, -Math.PI / 2, -1, 0);
      r = requests(-Math.PI / 2);
      assert.equal(r.length, 1, 'unexecuted request is not marked complete');
      assert.equal(w._event_ack(r[0].i, 1), 1);
      w._events_tick(-14, -2.8, 7.5, -Math.PI / 2, -1, 0);
      assert.equal(requests(-Math.PI / 2).length, 0, 'acknowledged one-shot remains complete');
      const move = () => {
        w._player_spawn(-15.6, -2.75, 7.5);
        let p;
        for (let i = 0; i < 150; i++) p = stepPlayer(w, -2 / 300, 0);
        return p;
      };
      assert.ok(move()[0] > -16.2, 'request alone keeps exit collision');
      assert.equal(w._scene_model_visible(exit.modelIndex), 1);
      const string = (s: any) => {
          const b = new TextEncoder().encode(s + '\0'),
            p = w._malloc(b.length);
          w.HEAPU8.set(b, p);
          return p;
        },
        a = string('gc_p00_010'),
        b = string('Play');
      try {
        assert.equal(w._events_demo_message(a, b), 1);
      } finally {
        w._free(a);
        w._free(b);
      }
      assert.equal(w._scene_model_visible(exit.modelIndex), 0);
      assert.ok(move()[0] < -16.4, 'original Play message deactivates only the exit door collider');
      assert.equal(w._world_owner_active(0, 0), 0);
      assert.equal(w._world_owner_active(99999, 0), 0, 'reject unknown collision owner');
    } finally {
      await handle.close();
    }
  },
);

test(
  'original acoustic zones, material surfaces and blocked radio line',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      scene = await loadHallway(w, Bun.file(process.env.PT_TEST_PSARC));
    const area = (p: any) => {
      const n = w._acoustic_area(...p);
      return Array.from({ length: n }, (_: any, i: any) => [
        w.UTF8ToString(w._acoustic_bus(i)),
        w._acoustic_level(i),
      ]);
    };
    assert.deepEqual(area([0, -1.4, -5]), [['passage', 1]]);
    assert.deepEqual(area([-8, -1.4, 7.5]), [['lobby', 1]]);
    assert.deepEqual(area([100, 0, 100]), []);
    assert.notEqual(w._acoustic_surface(0, -1.4, -5), 0);
    assert.equal(w._acoustic_blocked(0, 0.2, -5, -8.635407, -0.299998, 6.400008), 1);
    assert.equal(w._acoustic_blocked(-8, 0.2, 7.5, -8.635407, -0.299998, 6.400008), 0);
    const exit = scene.placements.find((p: any) => p.name.endsWith('_hallway_out'));
    assert.ok(exit?.owner);
    assert.equal(w._acoustic_blocked(-15.5, -1.8, 7.5, -17, -1.8, 7.5), 1);
    w._world_owner_active(exit.owner, 0);
    assert.equal(
      w._acoustic_blocked(-15.5, -1.8, 7.5, -17, -1.8, 7.5),
      0,
      'opening door clears acoustic obstruction',
    );
  },
);
