import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';

test(
  'f060 bathroom chain reaches f050 with native gaze, pickup, baby, mirror and door events',
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
    let sequenceBase = 0;
    const audio = {
      active: true,
      get sequenceSeconds() {
        return time - sequenceBase;
      },
      sequence: async () => {
        sequenceBase = time;
      },
      get time() {
        return time;
      },
      command: (name: string) =>
        ['SoundPostEvent', 'CallBGM', 'StopBGM', 'VisibleControlSubtitle'].includes(name),
      effect: (_key: string, effect: { play: string }) => sounds.push(effect.play),
      releaseEffects() {},
      finish() {},
      postId() {},
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
      function lookAt(position: number[], target: number[]) {
        const camera = [position[0], position[1] + 1.65, position[2]];
        const d = target.map((v, i) => v - camera[i]);
        host.cameraPose = {
          camera,
          yaw: Math.atan2(d[0], -d[2]),
          pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])),
          fov: Math.PI / 3,
        };
      }
      function run(position: number[], seconds: number, move = [0, 0]) {
        for (let i = 0; i < seconds * 30; i++) {
          time += 1 / 30;
          host.tick(position, Math.atan2(move[0], -move[1]), move);
          host.update(1 / 30);
        }
      }
      const pickup = [-3.3, -1.4, 5.7];
      lookAt(pickup, [-3.3, 1, 8]);
      run(pickup, 1);
      assert.notEqual(
        host.ambient.players.get('gc_p00_030').state,
        'playing',
        'wrong look does not collect flashlight',
      );
      lookAt(pickup, [-3.559, -1.376, 4.871]);
      run(pickup, 25);
      assert.equal(host.ambient.players.get('gc_p00_030').state, 'finished', 'pickup');
      assert.equal(host.ambient.handyEnabled, true, 'authored flashlight event');
      assert.equal(host.ambient.players.get('gc_p01_050').state, 'finished', 'bathroom locks');
      const baby = [-4.25, -1.4, 6.1];
      lookAt(baby, [-4.421, -0.46, 5.871]);
      run(baby, 80);
      assert.equal(host.ambient.players.get('gc_p01_090').state, 'finished', 'baby sequence');
      lookAt(baby, [-4.681, 0.212, 5.9]);
      run(baby, 20);
      assert.equal(host.ambient.players.get('gc_p01_020').state, 'finished', 'mirror');
      run([-3.22, -1.4, 6.82], 15, [0, 1]);
      assert.equal(host.ambient.players.get('gc_p01_022').state, 'finished', 'bathroom reopens');
      assert.equal(host.movementLocked, false, 'native PadEnable releases movement');
      assert.equal(host.floor, 'f060');
      for (let x = -3; x > -18 && host.phase !== 'sequence'; x -= 0.2)
        run([x, -1.4 - (x < -12 ? Math.min(1.25, (-x - 12) * 0.25) : 0), 7.5], 0.2, [-1, 0]);
      assert.equal(host.phase, 'sequence', 'native stair exit starts after bathroom');
      for (let i = 0; i < 150 && host.phase === 'sequence'; i++) {
        time += 1 / 60;
        host.update(1 / 60);
      }
      assert.equal(host.floor, 'f050', 'portrait loop reached');
      await host.preparation;

      assert.equal(w._scene_photo_word(), 0x10c);
      assert.equal(host.unsupported.size, 0);
    } finally {
      host.destroy();
      w._world_clear();
    }
    assert.equal(w._sequence_instance_count(), 0);
    const restored = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: { floor: 'f050', photoWord: 0x10c },
    });
    const resumed = await prepareFirstLoop(w, restored, file);
    try {
      assert.equal(resumed.floor, 'f050');
      assert.equal(w._scene_photo_word(), 0x10c);
    } finally {
      resumed.destroy();
      w._world_clear();
    }
    assert.equal(w._sequence_instance_count(), 0);
  },
);
