import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop, prepareOpening } from '../src/modules/gameplay/first-loop';
import { SaveGameStore } from '../src/modules/gameplay/save-game';

test(
  'reload restores authored floor setup, collected photos and playable collision without replaying earlier loops',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const file = Bun.file(process.env.PT_TEST_PSARC!),
      storage = new Map<string, string>();
    const store = new SaveGameStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    });
    for (const floor of ['f020', 'f030', 'f040'] as const) {
      store.write({ floor, photoWord: 0x10c });
      const checkpoint = store.read()!;
      const w = await create();
      const scene = await loadHallway(w, file, () => {}, { scripts: true, checkpoint });
      const host = await prepareFirstLoop(w, scene, file);
      let time = 0,
        sequenceBase = 0;
      try {
        host.attachAudio({
          active: true,
          get time() {
            return time;
          },
          get sequenceSeconds() {
            return time - sequenceBase;
          },
          sequence: async () => {
            sequenceBase = time;
          },
          finish() {},
          effect() {},
          releaseEffects() {},
          command: () => true,
        });
        assert.equal(host.floor, floor);
        assert.equal(host.cycle.current.floor, floor);
        assert.equal(w._scene_photo_word(), 0x10c);
        assert.equal(w._scene_photo_pending(), 0, 'menu piece stays collected');
        assert.equal(host.collectMenuPhoto(), false, 'menu piece cannot be collected twice');
        const piece = scene.placements.find((p: any) => p.nazo === 'PhotoLisa');
        assert.ok(piece);
        assert.equal(w._scene_model_visible(piece.modelIndex), 0);
        w._player_spawn(...scene.spawn.position);
        const position = stepPlayer(w, 0, 0);
        assert.ok([...position].every(Number.isFinite));
        assert.ok(scene.lights.some((l: any) => l.data[16]));
        assert.equal(host.unsupported.size, 0);
        if (floor === 'f040') {
          host.onCheckpoint = (checkpoint) => store.write(checkpoint);
          function walk(x: number, z: number, ticks: number) {
            for (let i = 0; i < ticks; i++) {
              const p = stepPlayer(w, x / 300, z / 300);
              if (i % 10 === 0) {
                time += 1 / 30;
                host.tick([...p].slice(0, 3), Math.atan2(x, -z), [x, z]);
                host.update(1 / 30);
              }
              if (host.phase === 'sequence') return;
            }
          }
          walk(0, 2, 1890);
          walk(-2, 0, 4000);
          assert.equal(host.ambient.players.get('gc_p04_350').state, 'finished');
          assert.equal(host.phase, 'sequence');
          for (let i = 0; i < 135 && host.phase === 'sequence'; i++) {
            time += 1 / 60;
            host.update(1 / 60);
          }
          assert.equal(host.floor, 'f060');
          assert.equal(store.read()?.floor, 'f060');
          assert.equal(store.read()?.photoWord, 0x10c);
        }
      } finally {
        host.destroy();
        w._world_clear();
      }
      assert.equal(w._sequence_instance_count(), 0);
    }
  },
);

test(
  'f060 resume executes original entrance lights and retains its checkpoint',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const storage = new Map<string, string>();
    const store = new SaveGameStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    });
    store.write({ floor: 'f060', photoWord: 0x10c });
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC!);
    try {
      const scene = await loadHallway(w, file, () => {}, {
        scripts: true,
        checkpoint: store.read()!,
      });
      const host = await prepareFirstLoop(w, scene, file);
      try {
        let time = 0;
        host.attachAudio({
          active: true,
          get time() {
            return time;
          },
          effect() {},
          releaseEffects() {},
          command: () => true,
        });
        host.update(0);
        assert.equal(host.floor, 'f060');
        assert.equal(host.ambient.players.get('gc_p03_070').state, 'playing');
        for (let i = 0; i < 40; i++) {
          time += 1 / 30;
          host.update(1 / 30);
        }
        assert.equal(host.ambient.players.get('gc_p03_070').state, 'finished');
        assert.ok(scene.lights.some((light: { data: Float32Array }) => light.data[16]));
        assert.equal(host.unsupported.size, 0);
      } finally {
        host.destroy();
      }
      assert.equal(w._sequence_instance_count(), 0);
      assert.equal(store.read()?.floor, 'f060');
      assert.equal(store.read()?.photoWord, 0x10c);
    } finally {
      w._world_clear();
    }
  },
);

test(
  'explicit restart restores the starting room without photo assets and begins the original opening',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const storage = new Map<string, string>();
    const store = new SaveGameStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    });
    store.write({ floor: 'f040', photoWord: 0x10c });
    store.reset();
    const w = await create();
    const file = Bun.file(process.env.PT_TEST_PSARC!);
    assert.equal(w._scene_photo_restore(1), 0, 'restoration requires a loaded scene');
    try {
      const scene = await loadHallway(w, file, () => {}, {
        scripts: true,
        kind: 'start',
        checkpoint: store.read()!,
      });
      assert.equal(w._scene_photo_word(), 1);
      assert.equal(w._scene_photo_restore(1), 1, 'restoring the same word is valid');
      assert.equal(w._scene_photo_restore(0x200), 0, 'invalid words remain rejected');
      assert.equal(w._scene_photo_word(), 1);
      const host = await prepareOpening(w, scene, file);
      try {
        const initial = host.update(0);
        assert.ok(Math.abs(initial.basis.up[0]) > 0.5, 'original wake-up camera');
        assert.ok(initial.camera[1] < 0.2);
      } finally {
        host.destroy();
      }
      assert.equal(store.read()?.floor, 'f000');
    } finally {
      w._world_clear();
    }
  },
);
