import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
test('worklet releases locator sounds with original stop policy and replays only water drops', () => {
  let Processor;
  const memory = new ArrayBuffer(65536),
    calls = [],
    messages = [],
    alive = new Set();
  let id = 0;
  const w: any = {
    HEAPU8: new Uint8Array(memory),
    HEAPF32: new Float32Array(memory),
    _malloc: () => 4096,
    _free: () => {},
    _audio_effect: (p: any, object: any, ...position: any) => {
      const name = new TextDecoder().decode(w.HEAPU8.subarray(p, w.HEAPU8.indexOf(0, p)));
      calls.push({ name, object, position });
      alive.add(++id);
      return id;
    },
    _audio_effect_transform: () => {},
    _audio_effect_release: (id: any, object: any, fade: any, curve: any, stop: any) => {
      calls.push({ release: id, fade, curve, stop });
      if (stop) alive.delete(id);
    },
    _audio_effect_alive: (id: any) => alive.has(id),
    _audio_effect_collect: () => 0,
    _audio_render: () => 4,
    _audio_notifications: () => 0,
  };
  const context = {
    AudioWorkletProcessor: class {},
    registerProcessor: (name: any, cls: any) => (Processor = cls),
    currentTime: 0,
    console,
    Math,
  };
  runInNewContext(
    readFileSync(new URL('../dist/audio-worklet.js', import.meta.url), 'utf8').replace(
      /import\s+\w+\s+from\s*['"]\.\/audio-core\.js['"];?/,
      '',
    ),
    context,
  );
  const p = Object.create(Processor.prototype);
  Object.assign(p, {
    w,
    bgm: new Set(),
    effects: new Map(),
    retired: [],
    captions: new Map(),
    playing: true,
    live: true,
    block: 0,
    port: {
      postMessage: (m: any) => {
        messages.push(m);
        if (m.type === 'error') throw Error(m.message);
      },
    },
  });
  const node = {
    play: 'Play_sfx_water_drop_b',
    stop: 'Stop_unused',
    stopPlaying: true,
    fade: 0.3,
    curve: 4,
  };
  p.command({ type: 'effect', key: 'locator:1:', node, position: [1, 2, 3] });
  p.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(calls.filter((c: any) => c.name).length, 1);
  alive.clear();
  p.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(calls.filter((c: any) => c.name).length, 2);
  p.command({ type: 'effects-release', prefix: 'locator:1:' });
  assert.ok(!calls.some((c: any) => c.name === 'Stop_unused'));
  assert.equal(p.effects.size, 0);
  assert.equal(calls.at(-1).fade, 0.3);
  p.command({
    type: 'effect',
    key: 'locator:2:',
    node: { ...node, play: 'Play_cry', stop: 'Stop_cry', stopPlaying: false },
    position: [3, 2, 1],
  });
  p.command({ type: 'effects-release', prefix: 'locator:2:' });
  assert.deepEqual(calls.find((c: any) => c.name === 'Stop_cry').position, [3, 2, 1]);
  w._audio_effect_id = (event: any, object: any, ...position: any) => {
    calls.push({ event, object, position });
    alive.add(++id);
    return id;
  };
  w._audio_effect_collect = (playing: any, object: any) => {
    if (alive.has(playing)) return 0;
    calls.push({ collected: object });
    return 1;
  };
  alive.clear();
  p.process([], [[new Float32Array(128), new Float32Array(128)]]);
  for (let i = 0; i < 300; i++) {
    p.command({
      type: 'effect',
      key: 'lamp:' + i,
      node: { event: 3728713853, stopPlaying: true, fade: 0, curve: 4 },
      position: [-8, 1.7, 8],
      transient: true,
    });
    const e = p.effects.get('lamp:' + i);
    assert.ok(e);
    alive.delete(e.playing);
    p.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(p.effects.size, 0);
    assert.equal(p.retired.length, 0, 'completed lamp voice frees its emitter');
  }
  assert.equal(calls.filter((c: any) => c.event === 3728713853).length, 300);
  w._audio_post = () => 1;
  w._audio_event_playing = () => 1;
  p.command({
    type: 'post',
    name: 'Play_bgm_unrest03',
    position: [0, 0, 0],
    spatial: false,
    bgm: true,
  });
  p.block = 93;
  p.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(messages.at(-1).type, 'bgm');
  assert.equal(messages.at(-1).states[0][0], 'Play_bgm_unrest03');
  assert.equal(messages.at(-1).states[0][1], 1);
  w._audio_event_playing = () => 0;
  p.block = 93;
  p.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(messages.at(-1).states[0][1], 0);
});
