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
      scene = await loadHallway(w, file, () => {}, { scripts: true });
    let events = [];
    const audio = {
      active: false,
      time: 0,
      effect: (...a: any) => events.push(a),
      releaseEffects: () => {},
    };
    const p = await prepareLamp(w, scene, file, audio);
    assert.ok(p, 'hallway has original ShGimmick lamp');
    p.update('f010');
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
