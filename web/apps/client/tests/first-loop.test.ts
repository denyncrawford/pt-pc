import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
import {
  prepareFirstLoop,
  rotateSH,
  transformPoint,
  inverseRigid,
  DEMO_FPS,
} from '../src/modules/gameplay/first-loop';
test('adjacent stage SH preserves irradiance after connector rotation', () => {
  const m = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, -22, -1, 7, 1]),
    sh = new Float32Array(36);
  for (let i = 0; i < 36; i++) sh[i] = Math.sin(i) * 0.3;
  const rotated = rotateSH(sh, m),
    evalSH = (s: any, n: any) => {
      const [x, y, z] = [-n[0], -n[2], n[1]],
        b = [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
      return [0, 1, 2].map((c: any) =>
        b.reduce((v: any, k: any, i: any) => v + k * s[i * 4 + c], 0),
      );
    };
  for (const n of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.3, 0.4, Math.sqrt(0.75)],
  ]) {
    const local = evalSH(sh, transformPoint(inverseRigid(m), n, 0)),
      world = evalSH(rotated, n);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(local[k] - world[k]) < 1e-6);
  }
});
test(
  'original Lua + stream: walk f010, open door, land in f005 and keep walking',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create({
      wasmBinary: readFileSync(
        new URL('../../../packages/engine-wasm/dist/geometry.wasm', import.meta.url),
      ),
    });
    assert.equal(w._sequence_sample(0, 0, 1), 0);
    assert.equal(w._sequence_actor_kind(0), -1);
    const file = Bun.file(process.env.PT_TEST_PSARC),
      scene = await loadHallway(w, file, () => {}, { scripts: true });
    assert.equal(scene.lights.filter((l: any) => l.data[16]).length, 30);
    assert.ok(
      scene.lights
        .filter((l: any) => l.data[16])
        .every((l: any) => l.name.includes('_ID60|') || l.name.includes('_clock|')),
    );
    assert.equal(scene.probes.filter((p: any) => p.name).length, 63);
    assert.equal(
      scene.updateNativeLighting(),
      false,
      'unchanged presets do not rebuild adjacent SH',
    );
    let clock = 0;
    const host = await prepareFirstLoop(w, scene, file);
    host.attachAudio({
      active: true,
      get time() {
        return clock / DEMO_FPS;
      },
      effect: () => {},
      releaseEffects: () => {},
      command: (name: any) => ['SoundPostEvent', 'VisibleControlSubtitle'].includes(name),
      sequence: async () => {},
      finish: () => {},
      get sequenceSeconds() {
        return clock / DEMO_FPS;
      },
    });
    assert.ok(host.ready);
    assert.ok(host.log.some((e: any) => e.type === 'LoadStage'));
    assert.equal(w._sequence_sample(9999, 0, 1), 0);
    assert.equal(w._sequence_sample(0, 0, NaN), 0);
    w._player_spawn(...scene.spawn.position);
    let p;
    function walk(x: any, z: any, ticks: any) {
      for (let i = 0; i < ticks; i++) {
        p = [...stepPlayer(w, x / 300, z / 300)].slice(0, 3);
        if (i % 10 === 0) {
          host.cameraPose = {
            camera: [p[0], p[1] + 1.65, p[2]],
            yaw: Math.atan2(x, -z),
            pitch: 0.1,
            fov: 1,
          };
          host.tick(p, Math.atan2(x, -z), [x, z]);
        }
        if (host.phase === 'sequence') return;
      }
    }
    walk(0, 2, 1890);
    walk(-2, 0, 3000);
    assert.equal(host.phase, 'sequence');
    assert.ok(p[0] < -15 && p[0] > -16);
    const door = scene.placements.find((p: any) => p.name.endsWith('_hallway_out'));
    assert.equal(
      w._scene_model_visible(door.modelIndex),
      0,
      'original Lua Play listener hides static door',
    );
    let view;
    for (let i = 0; i < 130 && host.phase === 'sequence'; i++) {
      clock++;
      view = host.update(1 / DEMO_FPS);
      if (i === 0) {
        assert.deepEqual(view.camera, host.cameraPose.camera);
        assert.equal(host.cameraBlend.metadata.cameraInterpFrame, 60);
        assert.equal(host.cameraBlend.metadata.cameraInterpType, 2);
      }
      assert.ok(view.camera.every(Number.isFinite));
      assert.ok(view.position.every(Number.isFinite));
      assert.ok(view.fov > 0.5 && view.fov < 1.5);
    }
    assert.equal(host.phase, 'active');
    assert.equal(host.completed, false, 'handoff alone does not certify the loop');
    assert.equal(view.transferred, true);
    assert.equal(host.floor, 'f005');
    assert.equal(host.eventCursor, host.events.length, 'no skipped stream events');
    assert.ok(Math.abs(view.position[1] + 1.4) < 0.01);
    assert.ok(view.position[2] > -5.2 && view.position[2] < -5);
    const messages = host.log
      .filter((e: any) => e.type === 'message' && !e.detail.includes(':'))
      .map((e: any) => e.detail);
    assert.deepEqual(messages, ['Play', 'FinishMotion', 'PlayEnd', 'Finish']);
    host.tick(view.position, Math.PI, [0, 1]);
    for (let i = 0; i < 900; i++) p = stepPlayer(w, 0, 2 / 300);
    assert.equal(p[3], 1);
    assert.ok(p[2] > 0.5, 'input and collisions survive stage transition');
    assert.equal(host.update(0.2), null, 'finished sequence cannot run twice');
    assert.equal(w._scene_model_visible(door.modelIndex), 1, 'next stage restores its exit door');
    for (let i = 0; i < 990; i++) {
      const q = stepPlayer(w, 0, 2 / 300);
      host.tick([...q].slice(0, 3), Math.PI, [0, 1]);
    }
    for (let i = 0; i < 3000; i++) {
      const q = stepPlayer(w, -2 / 300, 0);
      host.tick([...q].slice(0, 3), -Math.PI / 2, [-1, 0]);
    }
    assert.equal(
      host.ambient.players.get('gc_p04_310').state,
      'playing',
      'closed lobby prevents reaching the stop trap',
    );
    assert.ok(stepPlayer(w, 0, 0)[0] > -11.5, 'closed lobby blocks a premature exit');
    assert.equal(host.photoPrepared, false);
    assert.equal(
      host.phase,
      'active',
      'missing bathroom events leave the player able to backtrack',
    );
    assert.ok(scene.vertices.every(Number.isFinite));

    assert.equal(host.cycle.current.floor, 'f005');
    assert.equal(host.cycle.history.length, 1);
    host.destroy();
    assert.equal(w._sequence_instance_count(), 0);
    console.log(
      'Handoff validated (not full loop): 128 door frames, Lua ID60, grounded f005; concurrent clock active; direct exit correctly waits for bathroom events',
    );
  },
);
