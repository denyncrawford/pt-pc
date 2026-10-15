import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';

test(
  'f060 restored entrance runs native lights, insects and bathroom opening with pause-safe audio clock',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create();
    const file = Bun.file(process.env.PT_TEST_PSARC!);
    const scene = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: { floor: 'f060', photoWord: 0x10c },
    });
    const host = await prepareFirstLoop(w, scene, file);
    let time = 0;
    const sounds: string[] = [];
    const audio = {
      active: true,
      get time() {
        return time;
      },
      command: () => true,
      effect: (_key: string, effect: { play: string }) => sounds.push(effect.play),
      releaseEffects() {},
      finish() {},
    };
    host.attachAudio(audio);
    try {
      const lights = host.ambient.players.get('gc_p03_070');
      host.update(0);
      audio.active = false;
      host.update(10);
      assert.equal(lights.frame, 0, 'pause must not advance native entrance');
      audio.active = true;
      host.update(0);
      // Authored walkthrough waypoints isolate event wiring; continuous wall/door
      // collision is covered by the separate full traversal suite.
      for (const position of [
        [0, -1.4, -4],
        [0, -1.4, 6.3],
        [-1, -1.4, 7.4],
        [-3.2, -1.4, 7.4],
      ]) {
        for (let i = 0; i < 300; i++) {
          time += 1 / 30;
          host.tick(position, 0, [0, 1]);
          host.update(1 / 30);
        }
      }
      for (let i = 0; i < 600; i++) {
        time += 0.1;
        host.update(0.1);
      }
      for (const id of ['gc_p03_070', 'gc_p03_011', 'gc_p01_110'])
        assert.equal(host.ambient.players.get(id).state, 'finished', id);
      assert.ok(
        sounds.some((name) => name.includes('door_open')),
        'original opening sound dispatched',
      );
      assert.equal(host.floor, 'f060');
      assert.equal(w._scene_photo_word(), 0x10c);
      assert.equal(host.unsupported.size, 0);
    } finally {
      host.destroy();
      w._world_clear();
    }
    assert.equal(w._sequence_instance_count(), 0);
  },
);
