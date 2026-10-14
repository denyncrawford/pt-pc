import test from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/audio-core.js';
import { Psarc } from '../src/lib/archives';
import { withString } from '../src/modules/gameplay/runtime';
test(
  'native DSP: area sends create a reverb tail and blocked radio is attenuated',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const a = await new Psarc(Bun.file(process.env.PT_TEST_PSARC)).open(),
      banks = [];
    for (const name of [
      'Init.bnk',
      'sys_resident.sbp',
      'bg_common.sbp',
      'sfx_common.sbp',
      'bgm_common.sbp',
    ])
      banks.push([name, await a.read('as/sh/sound/asset/' + name)]);
    async function run(bus: any, blocked: any) {
      const w = await create();
      w._audio_reset();
      for (const [name, b] of banks) {
        const p = w._malloc(b.length);
        w.HEAPU8.set(b, p);
        withString(w, name, (s: any) => w._audio_load(s, p, b.length, +name.endsWith('.sbp')));
        w._free(p);
      }
      w._audio_start(123);
      w._audio_listener(-8, 0.2, 7.5, 0, 0, -1);
      if (bus) {
        const p = w._malloc(8);
        new Uint32Array(w.HEAPU8.buffer, p, 1)[0] = withString(w, bus, (b: any) =>
          w._audio_hash(b),
        );
        w.HEAPF32[p / 4 + 1] = 1;
        w._audio_sends(2, p, p + 4, 1);
        w._free(p);
      }
      if (blocked !== null) {
        w._audio_acoustic(1, blocked, 0);
        withString(w, 'Play_radio_f010', (p: any) =>
          w._audio_post(p, -8.635407, -0.299998, 6.400008, 1),
        );
      } else w._audio_footstep(1, 0, -8, -1.4, 7.5);
      let energy = 0,
        tail = 0;
      for (let t = 0; t < 48000 * 3; t += 128) {
        const p = w._audio_render(128) / 4;
        for (let j = 0; j < 256; j++) {
          const v = w.HEAPF32[p + j];
          energy += v * v;
          if (t > 48000) tail += v * v;
        }
      }
      return { energy, tail };
    }
    const dry = await run(null, null),
      wet = await run('passage', null),
      clear = await run(null, 0),
      blocked = await run(null, 1);
    assert.equal(dry.tail, 0);
    assert.ok(wet.tail > 1e-8, 'original bus effect continues after footstep');
    assert.ok(
      blocked.energy < clear.energy * 0.1,
      'original environment curves attenuate the blocked source',
    );
  },
);
