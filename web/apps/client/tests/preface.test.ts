import test from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import {
  loadPreface,
  readPrefaceCaptions,
  shouldPlayPreface,
} from '../src/modules/sequences/preface';
import { SEQUENCE_FPS } from '../src/modules/sequences/sequence-player';
import { loadHallway } from '../src/modules/gameplay/runtime';
import { prepareOpening } from '../src/modules/gameplay/first-loop';

test('malformed preface subtitle data fails explicitly', () => {
  assert.throws(() => readPrefaceCaptions(new Uint8Array(3)), /incompleta/);
  assert.throws(() => readPrefaceCaptions(new Uint8Array([0, 0, 255, 255])), /incompleto/);
});

test(
  'native preface shows original logo, text, fades and hands off only at frame 940',
  { skip: !process.env.PT_TEST_PSARC || !process.env.PT_TEST_QAR },
  async () => {
    const w = await create();
    const file = Bun.file(process.env.PT_TEST_PSARC!);
    const preface = await loadPreface(w, file, Bun.file(process.env.PT_TEST_QAR!), 'Eng');
    try {
      assert.equal(preface.length, 940);
      let current = 0;
      const at = (frame: number) => {
        const value = preface.update((frame - current) / SEQUENCE_FPS);
        current = frame;
        return value;
      };
      const visible = (frame: ReturnType<typeof at>, suffix: string) =>
        frame.pictures.some((p) => p.texture.endsWith(suffix) && p.opacity > 0.95);
      assert.ok(at(0).pictures.every((p) => p.opacity === 0));
      assert.ok(visible(at(100), 'sh_logo_company_alp.ftex'));
      assert.ok(!visible(at(270), 'sh_logo_company_alp.ftex'));
      const text = at(400);
      assert.ok(visible(text, 'sh_terop_op_01_alp.ftex'));
      assert.match(text.caption, /separate reality/);
      assert.match(at(650).caption, /only me/);
      assert.equal(at(939).finished, false);
      assert.equal(at(941).finished, true);
    } finally {
      preface.destroy();
    }
    assert.equal(w._sequence_instance_count(), 0);
  },
);

test(
  'wake-up waits for preface and preserves its initial camera; pause freezes preface',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC!);
    const scene = await loadHallway(w, file, () => {}, { scripts: true, kind: 'start' });
    const opening = await prepareOpening(w, scene, file);
    let elapsed = 0,
      destroyed = 0;
    opening.preface = {
      update(dt: number) {
        elapsed += dt;
        return elapsed >= 1;
      },
      destroy() {
        destroyed++;
      },
    };
    const audio = {
      active: false,
      sequence: async () => {},
      prepareStream: async () => {},
      releaseEffects() {},
      effect() {},
      finish() {},
    };
    await opening.attachAudio(audio);
    try {
      const initial = opening.update(0);
      opening.update(1);
      assert.equal(elapsed, 0);
      audio.active = true;
      const held = opening.update(0.5);
      assert.deepEqual(held.camera, initial.camera);
      assert.equal(opening.frame, 1);
      opening.update(0.5);
      assert.equal(destroyed, 1);
      assert.equal(opening.preface, null);
      opening.update(0.1);
      assert.ok(opening.frame > 1);
    } finally {
      opening.destroy();
    }
  },
);

test('new and resumed opening sessions include titles; hallway resumes do not', () => {
  for (const checkpoint of [undefined, { floor: 'f000' }, { floor: 'f010' }, { floor: 'f040' }]) {
    const kind = !checkpoint || checkpoint.floor === 'f000' ? 'start' : 'hallway';
    assert.equal(shouldPlayPreface(kind), !checkpoint || checkpoint.floor === 'f000');
  }
});
