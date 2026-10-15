import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, withString } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';
import { SaveGameStore, type Checkpoint } from '../src/modules/gameplay/save-game';

test(
  'solved portrait exits into f070; window, Lisa, glass, breath and checkpoint execute',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC!);
    const scene = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: { floor: 'f050', photoWord: 0x10c, xmarkWord: 4 },
    });
    const host = await prepareFirstLoop(w, scene, file);
    let time = 0,
      base = 0,
      particles = 0,
      lisa = false;
    const sounds: string[] = [],
      saved: Checkpoint[] = [];
    const audio = {
      active: true,
      get time() {
        return time;
      },
      get sequenceSeconds() {
        return time - base;
      },
      async sequence() {
        base = time;
      },
      command() {
        return true;
      },
      postId() {},
      effect(_key: string, sound: { play: string }) {
        sounds.push(sound.play);
      },
      releaseEffects() {},
      finish() {},
    };
    host.attachAudio(audio);
    host.onCheckpoint = (checkpoint: Checkpoint) => saved.push(checkpoint);
    function run(position: number[], frames = 60, move = [0, 0]) {
      for (let i = 0; i < frames; i++) {
        time += 1 / 30;
        host.tick(position, Math.atan2(move[0], -move[1]), move);
        host.update(1 / 30);
        particles = Math.max(particles, w._vfx_particles());
        lisa ||= [...host.ambient.players.get('gc_p04_120').models.values()].some(
          (actor: { name: string; created: boolean; visible: boolean }) =>
            actor.name === 'HM_och0_main0_def' && actor.created && actor.visible,
        );
      }
    }
    function approachExit() {
      for (let x = -10; x > -18 && host.phase !== 'sequence'; x -= 0.2)
        run([x, -1.4 - (x < -12 ? Math.min(1.25, (-x - 12) * 0.25) : 0), 7.5], 6, [-1, 0]);
    }
    try {
      for (const p of [
        [0, -1.4, -5.5],
        [0, -1.4, 6.3],
        [-3, -1.4, 7.5],
        [-7, -1.4, 7.5],
        [-10, -1.4, 7.5],
      ])
        run(p, 100);
      approachExit();
      assert.equal(host.floor, 'f050');
      assert.notEqual(host.phase, 'sequence', 'unsolved portrait cannot advance');
      w._scene_xmark_restore(8);
      w._events_reset();
      approachExit();
      assert.equal(host.phase, 'sequence');
      for (let i = 0; i < 150 && host.phase === 'sequence'; i++) {
        time += 1 / 30;
        host.update(1 / 30);
      }
      assert.equal(host.floor, 'f070');
      const hell = scene.placements.find((p: { nazo: string }) => p.nazo === 'HELL_Ican');
      assert.ok(hell);
      assert.equal(w._scene_model_visible(hell.modelIndex), 1, 'Hello preparation text visible');
      assert.equal(saved.at(-1)?.xmarkWord, 8);
      assert.equal(saved.at(-1)?.photoWord, 0x10c);
      // Original floor-enable volume must be entered before the window volumes.
      run([0, -1.4, -5.5], 60);
      run([0, -1.4, 6.3], 60);
      const window = host.ambient.players.get('gc_p04_120');
      assert.equal(window.state, 'ready', 'no premature appearance');
      run([-3.89, -1.4, 7.5], 900);
      assert.equal(window.state, 'finished');
      assert.ok(lisa, 'native Lisa actor becomes visible');
      assert.ok(particles > 0, 'native glass particles emitted');
      run([-8.37, -1.4, 7.9], 900);
      run([-2.11, -1.4, 7.5], 60);
      assert.equal(
        host.ambient.players.get('gc_p04_280').state,
        'stopped',
        'return trigger stops breath',
      );
      assert.equal(host.unsupported.size, 0);
      assert.ok(sounds.length > 0, 'original audio events delivered');
      approachExit();
      assert.equal(host.floor, 'f070');
      assert.notEqual(host.phase, 'sequence', 'unimplemented f080 stays bounded');
      assert.equal(w._scene_photo_word(), 0x10c);
    } finally {
      host.destroy();
      w._world_clear();
    }
    assert.equal(w._vfx_instances(), 0);
    assert.equal(w._sequence_instance_count(), 0);
    const storage = new Map<string, string>();
    const saves = new SaveGameStore({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => {
        storage.set(k, v);
      },
    });
    saves.write(saved.at(-1)!);
    const restored = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: saves.read()!,
    });
    const resumed = await prepareFirstLoop(w, restored, file);
    try {
      assert.equal(resumed.floor, 'f070');
      assert.equal(w._scene_xmark_word(), 8);
      assert.equal(w._scene_photo_word(), 0x10c);
      withString(w, 'f070', (p: number) => assert.equal(w._script_set_floor(p), 1));
    } finally {
      resumed.destroy();
      w._world_clear();
    }
  },
);
