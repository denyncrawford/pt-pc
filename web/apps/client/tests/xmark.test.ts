import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, withString } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';
import {
  SaveGameStore,
  validateCheckpoint,
  type Checkpoint,
} from '../src/modules/gameplay/save-game';

test('portrait state is validated, persisted and reset only explicitly', () => {
  const data = new Map<string, string>();
  const store = new SaveGameStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  });
  store.write({ floor: 'f050', photoWord: 4, xmarkWord: 4 });
  store.write({ floor: 'f050', photoWord: 4, xmarkWord: 8 });
  assert.equal(store.read()?.xmarkWord, 8);
  assert.deepEqual(validateCheckpoint({ floor: 'f050', photoWord: 4 }), {
    floor: 'f050',
    photoWord: 4,
  });
  assert.throws(() => validateCheckpoint({ floor: 'f050', photoWord: 4, xmarkWord: 7 }));
  store.reset();
  assert.equal(store.read()?.floor, 'f000');
  assert.equal(store.read()?.xmarkWord, undefined);
});

test(
  'native XMark requires aim and fresh action; changes assets, sound and save without collecting fragments',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC!);
    const scene = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: { floor: 'f050', photoWord: 4 },
    });
    const host = await prepareFirstLoop(w, scene, file);
    let time = 0;
    const sounds: number[] = [],
      captions: number[] = [],
      checkpoints: Checkpoint[] = [];
    host.attachAudio({
      active: true,
      get time() {
        return time;
      },
      command() {
        return true;
      },
      postId(id: number) {
        sounds.push(id);
      },
      showCaption(id: number) {
        captions.push(id);
      },
      effect() {},
      releaseEffects() {},
    });
    host.onCheckpoint = (checkpoint: Checkpoint) => checkpoints.push(checkpoint);
    const trap = Array.from({ length: w._trap_count() }, (_, i) => i).find((i) =>
      w.UTF8ToString(w._trap_name(i)).endsWith('|trap_x_mark'),
    );
    assert.notEqual(trap, undefined);
    const b = w._trap_box(trap, 0) / 4,
      eye = Array.from(w.HEAPF32.slice(b + 12, b + 15)) as number[];
    const portrait = scene.placements.find((p: { nazo: string }) => p.nazo === 'XMark');
    const delta = Array.from(portrait.matrix.slice(12, 15), (v: number, i: number) => v - eye[i]);
    const yaw = Math.atan2(delta[0], -delta[2]),
      pitch = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
    function tick(action = false, facing = yaw, outside = false) {
      host.cameraPose = { camera: eye, yaw: facing, pitch, fov: 1 };
      time += 1 / 30;
      host.tick([eye[0] + (outside ? 100 : 0), eye[1] - 0.8, eye[2]], 0, [0, 0], false, action);
      host.update(1 / 30);
    }
    try {
      tick();
      tick(true, yaw + Math.PI);
      tick();
      assert.equal(w._scene_xmark_word(), 4, 'wrong aim');
      tick(false, yaw, true);
      tick(true, yaw, true);
      tick();
      assert.equal(w._scene_xmark_word(), 4, 'outside the authored trigger');
      tick();
      tick(true);
      assert.equal(w._scene_xmark_word(), 8);
      assert.equal(w._scene_model_visible(portrait.modelIndex), 0);
      const solved = scene.placements.find((p: { nazo: string }) => p.nazo === 'XMarkPic1');
      assert.equal(w._scene_model_visible(solved.modelIndex), 1);
      for (let i = 0; i < 120; i++) tick(true);
      assert.equal(sounds.filter((id) => id === 0xa5fdfc86).length, 1);
      assert.equal(sounds.filter((id) => id === 0xf27dac95).length, 1);
      assert.equal(w._scene_photo_word(), 4, 'independent of Photo fragments');
      assert.equal(checkpoints.at(-1)?.xmarkWord, 8);
      const textTrap = Array.from({ length: w._trap_count() }, (_, i) => i).find((i) =>
        w.UTF8ToString(w._trap_name(i)).endsWith('|trap_x_mark_terop'),
      );
      assert.notEqual(textTrap, undefined);
      const textBox = w._trap_box(textTrap, 0) / 4;
      const textEye = Array.from(w.HEAPF32.slice(textBox + 12, textBox + 15)) as number[];
      const textModel = scene.placements.find((p: { nazo: string }) => p.nazo === 'XMarkText');
      const textDelta = Array.from(
        textModel.matrix.slice(12, 15),
        (v: number, i: number) => v - textEye[i],
      );
      host.cameraPose = {
        camera: textEye,
        yaw: Math.atan2(textDelta[0], -textDelta[2]),
        pitch: Math.atan2(textDelta[1], Math.hypot(textDelta[0], textDelta[2])),
        fov: 1,
      };
      const textPosition = [textEye[0], textEye[1] - 0.8, textEye[2]];
      host.tick(textPosition, 0);
      host.tick(textPosition, 0, [0, 0], true);
      assert.deepEqual(
        captions,
        [0x4af4f3d4],
        'original caption requested when zooming at the revealed text',
      );
      assert.equal(host.unsupported.size, 0);
      assert.equal(
        withString(w, 'Clearf050', (p: number) => w._script_controller_message(p)),
        0,
        'first visit already opens lobby; disabled listener is respected',
      );
    } finally {
      host.destroy();
      w._world_clear();
    }
    const restored = await loadHallway(w, file, () => {}, {
      scripts: true,
      checkpoint: checkpoints.at(-1)!,
    });
    assert.equal(w._scene_xmark_word(), 8);
    const model = restored.placements.find((p: { nazo: string }) => p.nazo === 'XMarkPic1');
    assert.equal(w._scene_model_visible(model.modelIndex), 1, 'solved artwork survives reload');
    w._world_clear();
  },
);
