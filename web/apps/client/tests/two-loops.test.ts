import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';
test(
  'walk original f010 and f005 backtracking route before allowing f020',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC),
      measurements = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const started = performance.now(),
        scene = await loadHallway(w, file, () => {}, { scripts: true }),
        host = await prepareFirstLoop(w, scene, file);
      let time = 0,
        sequenceBase = 0;
      const sounds = [],
        commands = [];
      host.attachAudio({
        active: true,
        get time() {
          return time;
        },
        get sequenceSeconds() {
          return time - sequenceBase;
        },
        sequence: async () => {
          sequenceBase = time;
        },
        command: (n: any, args: any) => {
          commands.push([n, args]);
          return ['SoundPostEvent', 'VisibleControlSubtitle'].includes(n);
        },
        finish: () => {},
        effect: (key: any, node: any) => sounds.push(node.play),
        releaseEffects: () => {},
      });
      w._player_spawn(...scene.spawn.position);
      function walk(x: any, z: any, ticks: any) {
        for (let i = 0; i < ticks; i++) {
          const p = stepPlayer(w, x / 300, z / 300);
          if (i % 10 === 0) {
            time += 1 / 30;
            host.tick([...p].slice(0, 3), Math.atan2(x, -z), [x, z]);
            host.update(1 / 30);
          }
          if (host.phase === 'sequence') return;
        }
      }
      async function exit() {
        assert.equal(host.phase, 'sequence');
        let view;
        for (let i = 0; i < 135 && host.phase === 'sequence'; i++) {
          time += 1 / 60;
          view = host.update(1 / 60);
        }
        assert.ok(view.transferred);
        if (host.preparation) await host.preparation;
        return view;
      }
      try {
        walk(0, 2, 1890);
        walk(-2, 0, 3000);
        await exit();
        assert.equal(host.floor, 'f005');
        host.tick([...stepPlayer(w, 0, 0)].slice(0, 3), Math.PI, [0, 1]);
        walk(0, 2, 1890);
        walk(-2, 0, 1200);
        assert.equal(host.ambient.players.get('gc_p04_310').state, 'playing');
        walk(2, 0, 240);
        assert.equal(host.ambient.players.get('gc_p01_070').state, 'playing');
        assert.equal(host.photoPrepared, true);
        for (let i = 0; i < 610; i++) {
          time += 1 / 60;
          host.update(1 / 60);
        }
        assert.equal(host.ambient.players.get('gc_p01_070').state, 'finished');
        assert.equal(sounds.filter((n: any) => n === 'Play_sfx_head_struck_02').length, 7);
        // The authored f005 opening trigger is back in the first corridor, at z=2.05.
        const lobby = scene.placements.find((p: any) => p.name.endsWith('_lobby'));
        assert.equal(w._scene_model_visible(lobby.modelIndex), 1);
        walk(-2, 0, 1500);
        assert.ok(stepPlayer(w, 0, 0)[0] > -11.5, 'closed lobby blocks passage');
        walk(2, 0, 1650);
        walk(0, -2, 825);
        assert.equal(
          w._scene_model_visible(lobby.modelIndex),
          0,
          'native return trigger opens lobby',
        );
        walk(0, 2, 825);
        host.unsupported.add('test-pending');
        walk(-2, 0, 3000);
        assert.notEqual(host.phase, 'sequence', 'pending event prevents premature exit');
        host.unsupported.delete('test-pending');
        host.tick([...stepPlayer(w, 0, 0)].slice(0, 3), -Math.PI / 2, [-1, 0]);
        assert.equal(host.phase, 'sequence', 'exit retries while player remains at the door');
        assert.deepEqual(host.blocking, []);
        assert.equal(host.ambient.players.get('gc_p04_310').state, 'stopped');
        await exit();
        assert.ok(
          commands.some(
            ([n, args]: any) => n === 'SoundPostEvent' && args[0] === 'Set_rtpc_rainfall_s_direct',
          ),
          'original floor script configures rain',
        );
        assert.equal(host.floor, 'f020');
        assert.equal(host.completed, false);
        assert.equal(host.unsupported.size, 0);
        assert.deepEqual(host.cycle.history, [
          { from: 'f010', to: 'f005' },
          { from: 'f005', to: 'f020' },
        ]);
      } finally {
        host.destroy();
        assert.equal(w._sequence_instance_count(), 0);
      }
      measurements.push({
        cycle: cycle + 1,
        elapsedMs: Math.round(performance.now() - started),
        sequenceBytes: w._sequence_resident_bytes(),
        liveBytes: w._sequence_live_heap_bytes(),
        wasmHeap: w.HEAPU8.buffer.byteLength,
      });
    }
    assert.ok(measurements.every((m: any) => m.sequenceBytes === measurements[0].sequenceBytes));
    assert.ok(
      measurements[2].liveBytes <= measurements[0].liveBytes,
      'live native allocations do not accumulate across three routes',
    );
    console.log('Three headless route cycles: ' + JSON.stringify(measurements));
  },
);
