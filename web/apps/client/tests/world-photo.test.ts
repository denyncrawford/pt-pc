import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, withString } from '../src/modules/gameplay/runtime';

test(
  'original photo traps require aim, a fresh Zoom press and two seconds held',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create();
    const scene = await loadHallway(w, Bun.file(process.env.PT_TEST_PSARC!), () => {}, {
      scripts: true,
    });
    const floor = (name: string) => withString(w, name, (p: number) => w._script_set_floor(p));
    floor('f020');
    const pieces = ['PhotoLisa', 'PhotoTree', 'PhotoGap', 'PhotoBath', 'PhotoStair'];
    const traps = ['lisa', 'tree', 'gap', 'bath', 'stair'];
    for (let i = 0; i < pieces.length; i++) {
      const trap = Array.from({ length: w._trap_count() }, (_, n) => n).find((n) =>
        w.UTF8ToString(w._trap_name(n)).endsWith('trap_photo_' + traps[i]),
      );
      assert.notEqual(trap, undefined);
      const box = w._trap_box(trap, 0) / 4;
      const eye = Array.from(w.HEAPF32.slice(box + 12, box + 15)) as number[];
      const model = scene.placements.find(
        (p: { modelIndex: number }) =>
          w.UTF8ToString(w._scene_model_nazo(p.modelIndex)) === pieces[i],
      );
      assert.ok(model);
      const matrix = w._scene_matrix(model.modelIndex) / 4;
      const target = Array.from(w.HEAPF32.slice(matrix + 12, matrix + 15)) as number[];
      const delta = target.map((v, k) => v - eye[k]);
      const yaw = Math.atan2(delta[0], -delta[2]);
      const pitch = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
      const bit = 8 << i;
      const frame = (held: boolean, facing = yaw, outside = false) => {
        const result = w._events_view(...eye, facing, pitch, 0.8, held ? 1 : 0, 1 / 30);
        w._events_tick(eye[0] + (outside ? 100 : 0), eye[1] - 0.8, eye[2], 0, 0, 0);
        return result;
      };
      w._events_reset();
      frame(false);
      for (let n = 0; n < 90; n++) frame(true, yaw + Math.PI);
      assert.equal(w._scene_photo_word() & bit, 0, 'target behind camera cannot be collected');
      frame(false);
      for (let n = 0; n < 90; n++) frame(true, yaw, true);
      assert.equal(w._scene_photo_word() & bit, 0, 'outside authored trap');
      frame(false);
      for (let n = 0; n < 30; n++) frame(true);
      frame(false);
      assert.equal(w._scene_photo_word() & bit, 0, 'releasing early cancels');
      for (let n = 0; n < 60; n++) frame(true);
      assert.equal(w._scene_photo_word() & bit, 0, 'requires more than two seconds');
      let collected = 0;
      for (let n = 0; n < 5; n++) collected |= frame(true);
      assert.equal(collected, bit);
      assert.equal(w._scene_photo_word() & bit, bit);
      assert.equal(w._scene_model_visible(model.modelIndex), 0, 'collected piece disappears');
      const frameModel = scene.placements.find(
        (p: { modelIndex: number }) =>
          w.UTF8ToString(w._scene_model_nazo(p.modelIndex)) === pieces[i].replace('Photo', 'Frame'),
      );
      assert.ok(frameModel);
      assert.equal(
        w._scene_model_visible(frameModel.modelIndex),
        1,
        'frame gains its original fragment',
      );
      for (let n = 0; n < 90; n++) assert.equal(frame(true), 0, 'no duplicate collection');
      frame(false);
    }
    assert.equal(w._scene_photo_word(), 0xfc);
    assert.equal(w._scene_photo_collect_option(), 1);
    assert.equal(w._scene_photo_word(), 0x1fc);
    floor('f030');
    assert.equal(w._scene_photo_word(), 0x1fc, 'fragments survive a floor change');
  },
);
