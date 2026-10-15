import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway } from '../src/modules/gameplay/runtime';
import { prepareLamp, LampPlayer, lampMotionForFloor } from '../src/modules/effects/lamp';
test('lamp clock crosses cues once, retains phase between floors, freezes on pause and retires on disable', () => {
  const events = [],
    released = [],
    poses = [],
    audio = {
      active: true,
      time: 0,
      effect: (...a: any) => events.push(a),
      releaseEffects: (p: any) => released.push(p),
    };
  const cue = (frame: any) => ({ frame, event: frame, position: [1, 2, 3], sends: [] });
  const clips = new Map([
    ['CeilLamp', { frames: 10, fps: 10, loop: true, events: [cue(1), cue(9)] }],
    ['CeilLampStrong', { frames: 5, fps: 10, loop: true, events: [cue(2)] }],
  ]);
  const p = new LampPlayer(clips, audio, (_: any, f: any) => poses.push(f));
  p.update('f010');
  audio.time = 0.15;
  p.update('f010');
  p.update('f010');
  assert.deepEqual(
    events.map((e: any) => e[1].event),
    [1],
  );
  audio.time = 0.95;
  p.update('f005');
  assert.deepEqual(
    events.map((e: any) => e[1].event),
    [1, 9],
  );
  assert.equal(released.length, 1, 'ordinary transfer retains the existing clip');
  audio.time = 1.15;
  p.update('f020');
  assert.deepEqual(
    events.map((e: any) => e[1].event),
    [1, 9, 1],
  );
  audio.time = 10;
  p.update('f020', true);
  audio.time = 20;
  p.update('f020');
  assert.equal(events.length, 3, 'no backlog after pause');
  audio.time = 20.8;
  p.update('f020');
  assert.equal(events.length, 4);
  assert.equal(events[3][1].event, 9);
  p.update('f080');
  assert.equal(p.motion, null);
  audio.time = 21;
  p.update('f100');
  audio.time = 21.25;
  p.update('f100');
  assert.equal(events.at(-1)[1].event, 2);
  p.destroy();
  const n = events.length;
  p.update('f010');
  p.destroy();
  assert.equal(events.length, n);
  assert.ok(events.every((e: any) => e[3].transient));
  assert.equal(lampMotionForFloor('f000'), null);
});
test(
  'original lamp player resolves the sound bone and plays complete normal and strong cycles',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC),
      scene = Object.assign(await loadHallway(w, file, () => {}, { scripts: true }), {
        baseLightingCounts: { lights: 0, probes: 0 },
      });
    let events = [];
    const audio = {
      active: false,
      time: 0,
      effect: (...a: any) => events.push(a),
      releaseEffects: () => {},
    };
    const baseLightCount = scene.lights.length;
    const adjacent = scene.lights.map((light: { name: string; data: Float32Array }) => ({
      ...light,
      name: 'next:' + light.name,
      data: light.data.slice(),
    }));
    scene.baseLightingCounts = { lights: baseLightCount, probes: scene.probes.length };
    scene.lights = [...scene.lights, ...adjacent];
    const p = await prepareLamp(w, scene, file, audio);
    assert.ok(p, 'hallway has original ShGimmick lamp');
    const light = scene.lights.find((l: { name: string }) => l.name === 'CeilLampFlareLight');
    assert.ok(light, 'authored VFX light is added, not a synthetic fill light');
    assert.equal(scene.baseLightingCounts.lights, baseLightCount + 1);
    assert.equal(scene.lights[baseLightCount], light, 'lamp remains inside the active-room range');
    assert.equal(
      scene.lights[baseLightCount + 1],
      adjacent[0],
      'adjacent-room slots follow the lamp',
    );
    assert.equal(light.data[18], 2000, 'native effect emits 2000 lumen');
    assert.equal(light.data[15], 1, 'native spotlight shadows retained');
    assert.ok(
      light.data[11] > 0,
      '180 degree authored cone retains spot classification, never becomes omnidirectional',
    );
    assert.ok(
      light.data[4] > light.data[5] && light.data[5] > light.data[6],
      'native warm temperature',
    );
    assert.ok(
      light.data[1] > 1 && light.data[1] < 2,
      'effect follows body bone, not ceiling locator',
    );
    const lightBefore = light.data.slice();
    const groups = scene.groups.filter((g: any) => g.demoActor?.lamp);
    assert.equal(groups.length, 4, 'original lamp mesh variants appended once');
    p.update('f010');
    assert.equal(groups.filter((g: any) => g.visible).length, 2, 'body and white bulb visible');
    const before = scene.vertices.slice(p.visual.first * 6);
    p.sample(p.clips.get('CeilLamp'), 45);
    assert.ok(scene.vertices.slice(p.visual.first * 6).every(Number.isFinite));
    assert.notDeepEqual(scene.vertices.slice(p.visual.first * 6), before, 'native rig moves mesh');
    assert.notDeepEqual(
      light.data.slice(0, 3),
      lightBefore.slice(0, 3),
      'light moves with the same native rig',
    );
    scene.updateNativeLighting?.();
    assert.equal(light.data[16], 1, 'preset updates do not clear VFX light');
    const rendered = groups.map((g: any) => ({ ...g }));
    p.visual.bindGroups(rendered);
    p.update('f080');
    assert.equal(light.data[16], 0, 'disabled lamp contributes no light');
    assert.ok(rendered.every((g: any) => !g.visible));
    p.update('f010');
    assert.equal(rendered.filter((g: any) => g.visible).length, 2);
    assert.equal(light.data[16], 1, 'lamp light restored on active floor');
    assert.equal(events.length, 0);
    audio.active = true;
    p.update('f010');
    const clip = p.clips.get('CeilLamp');
    assert.equal(clip.events.length, 8);
    assert.ok(clip.events.every((e: any) => e.position.every(Number.isFinite)));
    for (let i = 1; i <= 2 * clip.frames + 1; i++) {
      audio.time = i / clip.fps;
      p.update(i > clip.frames ? 'f005' : 'f010');
    }
    assert.equal(events.length, 16);
    assert.deepEqual(
      events.slice(0, 8).map((e: any) => e[1].event),
      clip.events.map((e: any) => e.event),
    );
    p.update('f100');
    events = [];
    const strong = p.clips.get('CeilLampStrong'),
      origin = audio.time;
    for (let i = 1; i <= strong.frames; i++) {
      audio.time = origin + i / strong.fps;
      p.update('f100');
    }
    assert.equal(events.length, 4);
    console.log(
      'Lamp original bone cue positions',
      JSON.stringify(
        clip.events.map((e: any) => ({ frame: e.frame, position: e.position, event: e.event })),
      ),
    );
    p.destroy();
  },
);
