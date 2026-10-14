import test from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { prepareLocomotion, loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
test(
  'original rig locomotion: contact markers, root motion, directions, stop and reset',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC),
      a = await prepareLocomotion(w, file);
    assert.equal(w._locomotion_clip_frames(0, 0), 72);
    assert.equal(w._locomotion_contacts(0, 0), 2);
    assert.deepEqual(
      [0, 1].map((i: any) => [
        w._locomotion_contact_frame(0, 0, i),
        w._locomotion_contact_left(0, 0, i),
      ]),
      [
        [18, 0],
        [54, 1],
      ],
    );
    for (const [x, z, clip] of [
      [0, 1, 0],
      [1, 0, 1],
      [0, -1, 2],
      [-1, 0, 3],
    ]) {
      a.reset(-Math.PI);
      let distance = 0,
        steps = 0,
        firstHead = null,
        headChanged = false;
      for (let i = 0; i < 1500; i++) {
        const p = a.step(x, z, -Math.PI, 1 / 300);
        distance += Math.hypot(p[0], p[1]);
        firstHead ??= p[5];
        headChanged ||= Math.abs(firstHead - p[5]) > 0.001;
        if (p[2]) {
          steps += p[2];
          const frames = Array.from(
            { length: w._locomotion_contacts(p[10], p[9]) },
            (_: any, j: any) => [
              w._locomotion_contact_frame(p[10], p[9], j),
              w._locomotion_contact_left(p[10], p[9], j),
            ],
          );
          assert.ok(
            frames.some(([f, left]: any) => p[8] >= f && p[8] - f < 0.21 && p[3] === left),
            'contact belongs to the original clip frame and side',
          );
        }
      }
      assert.equal(a.pose[9], clip);
      assert.ok(distance > 3 && distance < 9);
      assert.ok(steps >= 3);
      assert.ok(headChanged, 'original head rig animates the eye');
      let stopped = 0;
      for (let i = 0; i < 600; i++) {
        const p = a.step(0, 0, -Math.PI, 1 / 300);
        if (i > 300) stopped += p[2];
      }
      assert.equal(stopped, 0);
      assert.equal(a.pose[9], 4);
    }
    const scene = await loadHallway(w, file);
    a.reset(-Math.PI);
    w._player_spawn(...scene.spawn.position);
    let wallContacts = 0,
      p;
    for (let i = 0; i < 1600; i++) {
      const pose = a.step(1, 0, -Math.PI, 1 / 300);
      p = stepPlayer(w, pose[0], pose[1]);
      if (i > 600) wallContacts += pose[2];
    }
    assert.ok(p[0] > -0.4 && p[0] < -0.2);
    assert.ok(wallContacts > 0, 'native foot contacts still sound against walls');
    a.reset(-Math.PI);
    assert.equal(a.pose[2], 0);
    assert.equal(a.pose[8], 0);
  },
);
