import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, withString } from '../src/modules/gameplay/runtime';
import { SceneAmbience } from '../src/modules/audio/audio';
test(
  'native listener areas expose ambience and do not repost on every frame or during pause',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC);
    await loadHallway(w, file, () => {}, { scripts: true });
    const zones = new Map();
    for (let x = -20; x < 3; x += 0.5)
      for (let z = -5; z < 10; z += 0.5) {
        w._acoustic_area(x, 0, z);
        const a = withString(w, '', (p: any) =>
          JSON.parse(w.UTF8ToString(w._acoustic_ambience(p))),
        );
        if (a.event && !zones.has(a.event)) zones.set(a.event, { ...a, position: [x, 0, z] });
      }
    assert.ok(zones.has('Play_bg_bathroom01'), 'original bathroom ambience');
    console.log('Native ambience areas', JSON.stringify([...zones.values()]));
    const commands = [],
      audio = { active: false, ambience: (a: any) => commands.push(a) },
      host = new SceneAmbience(w, audio),
      bath = zones.get('Play_bg_bathroom01').position;
    host.update(bath, 0.1);
    assert.equal(commands.length, 0);
    audio.active = true;
    host.update(bath, 0);
    assert.equal(commands.length, 0);
    host.update(bath, 0.1);
    host.update(bath, 0.1);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].event, 'Play_bg_bathroom01');
    assert.equal(commands[0].volume, 'volumeRtpc');
    host.update([100, 100, 100], 0.1);
    assert.equal(commands[1].event, '');
    assert.ok(commands.every((a: any) => Number.isFinite(a.rate) && a.rate > 0));
  },
);
