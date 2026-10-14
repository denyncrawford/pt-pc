import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadDemoResources } from '../src/modules/sequences/demo-resources';
import { SequenceClock, SequencePlayer } from '../src/modules/sequences/sequence-player';
test(
  'original clock and f005 effects resolve through demo-local mappings to native sound nodes',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      r = await loadDemoResources(w, Bun.file(process.env.PT_TEST_PSARC));
    for (const [id, count, sound] of [
      ['gc_p05_010', 60, 'Play_sfx_digiclock_tick_solo'],
      ['gc_p01_070', 7, 'Play_sfx_head_struck_02'],
    ]) {
      const meta = r.metadata.get(id),
        p = new SequencePlayer(w, r.read(meta.demoStreamPath), id, new SequenceClock());
      try {
        const effects = p.events.filter((e: any) => e.functor === 0xba70c25c5ca2n);
        assert.equal(effects.length, count);
        for (const e of effects) {
          const effect = p.use(() =>
            r.effect(id, BigInt.asUintN(64, w._sequence_event_string(e.index, 0xc5d7e215))),
          );
          assert.deepEqual(effect.nodes, ['FxModuleGraph', 'FxSoundCallProgramEffectNode']);
          assert.equal(effect.sound.play, sound);
          assert.equal(effect.sound.stopPlaying, id === 'gc_p05_010');
        }
        assert.throws(() => r.effect(id, 123n), /sin resolver/);
      } finally {
        p.destroy();
      }
    }
    const coc = r.metadata.get('gc_p04_310');
    assert.equal(Object.keys(coc.modelFiles).length, 2);
    for (const path of Object.values<any>(coc.modelFiles)) assert.ok(r.read(path).length > 0);
    assert.equal(w._sequence_instance_count(), 0);
  },
);
