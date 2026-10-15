import { test } from 'node:test';
import assert from 'node:assert/strict';
import create from '../../../packages/engine-wasm/dist/geometry.js';
import { loadHallway, stepPlayer } from '../src/modules/gameplay/runtime';
import { prepareFirstLoop } from '../src/modules/gameplay/first-loop';
import { SaveGameStore } from '../src/modules/gameplay/save-game';
import { prepareLocatorSounds } from '../src/modules/audio/audio';
test(
  'walk original f010 → f060 in three sessions with resumable checkpoints',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await create(),
      file = Bun.file(process.env.PT_TEST_PSARC),
      measurements = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const started = performance.now(),
        scene = await loadHallway(w, file, () => {}, { scripts: true }),
        host = await prepareFirstLoop(w, scene, file);
      // Appending a skinned gimmick replaces these typed arrays after preparing the loop.
      scene.vertices = new Float32Array(scene.vertices);
      scene.tangents = new Float32Array(scene.tangents);
      host.vertices = scene.vertices;
      const storage = new Map<string, string>();
      const saves = new SaveGameStore({
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      });
      host.onCheckpoint = (checkpoint) => saves.write(checkpoint);
      let time = 0,
        sequenceBase = 0;
      const f040Lamp = new Set<number>();
      const f040Lights = new Set<string>(),
        f040Probes = new Set<string>(),
        f040Lisa = new Set<boolean>(),
        f040Cries = new Set<string>();
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
          return ['SoundPostEvent', 'VisibleControlSubtitle', 'CallBGM', 'StopBGM'].includes(n);
        },
        finish: () => {},
        effect: (key: any, node: any) => sounds.push(node.play),
        releaseEffects: () => {},
      });
      const locators = await prepareLocatorSounds(w, scene, file, host.audio);
      w._player_spawn(...scene.spawn.position);
      function walk(x: any, z: any, ticks: any) {
        for (let i = 0; i < ticks; i++) {
          const p = stepPlayer(w, x / 300, z / 300);
          if (i % 10 === 0) {
            time += 1 / 30;
            host.tick([...p].slice(0, 3), Math.atan2(x, -z), [x, z]);
            host.update(1 / 30);
            locators.update();
            if (host.floor === 'f040') {
              f040Lamp.add(w._lamp_stage_light());
              for (const light of scene.lights)
                if (light.nativeSlot && light.data[16])
                  f040Lights.add(light.name.match(/_light_(ID\d+)\|/)?.[1]);
              for (const probe of scene.probes)
                if (probe.name) f040Probes.add(probe.name.match(/_light_(ID\d+)\|/)?.[1]);
              const lisa = scene.placements.find((p: any) =>
                p.name.endsWith('shsb_hous001_ocho001_0000'),
              );
              f040Lisa.add(!!w._scene_model_visible(lisa.modelIndex));
              if (w._scene_model_visible(lisa.modelIndex)) {
                const groups = host.groups.filter(
                  (g: any) => !g.stage && g.modelIndex === lisa.modelIndex && !g.demoActor,
                );
                assert.ok(groups.length > 0, 'Lisa has render groups in the current hallway');
                assert.ok(
                  groups.some((g: any) => g.visible !== false && g.count > 0),
                  'native Lisa visibility reaches drawable geometry',
                );
              }
              for (const locator of locators.items)
                if (locator.visible) {
                  const path = w.UTF8ToString(w._fx_locator_path(locator.index));
                  if (path.includes('cry_') && sounds.includes(locator.node.play))
                    f040Cries.add(path);
                }
            }
          }
          if (host.phase === 'sequence') return;
        }
      }
      async function exit() {
        assert.equal(host.phase, 'sequence');
        const exitDoor = scene.placements.find((p: { name: string }) =>
          p.name.endsWith('_hallway_out'),
        );
        const offset = exitDoor.vertexFirst * 6;
        const doorBefore = scene.vertices.slice(offset, offset + exitDoor.vertexCount * 6);
        let doorMoved = false;
        let view;
        for (let i = 0; i < 135 && host.phase === 'sequence'; i++) {
          time += 1 / 60;
          view = host.update(1 / 60);
          if (i === 60)
            doorMoved = doorBefore.some((v: number, k: number) => v !== scene.vertices[offset + k]);
          locators.update();
        }
        assert.ok(doorMoved, 'exit animation updates the current render vertex array');
        assert.ok(view.transferred);
        assert.equal(saves.read()?.floor, host.floor, 'successful transfer persists destination');
        assert.equal(saves.read()?.photoWord, w._scene_photo_word());
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
          locators.update();
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
        walk(-2, 0, 3000);
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
        assert.equal(host.collectMenuPhoto(), true);
        assert.equal(host.collectMenuPhoto(), false);
        assert.equal(w._scene_photo_word(), 0x104);
        assert.equal(saves.read()?.photoWord, 0x104, 'collecting menu photo saves immediately');
        assert.equal(host.completed, false);
        assert.equal(host.unsupported.size, 0);
        assert.deepEqual(host.cycle.history, [
          { from: 'f010', to: 'f005' },
          { from: 'f005', to: 'f020' },
        ]);
        host.tick([...stepPlayer(w, 0, 0)].slice(0, 3), Math.PI, [0, 1]);
        walk(0, 2, 1890);
        walk(-2, 0, 1200);
        walk(2, 0, 240);
        for (let i = 0; i < 120; i++) {
          time += 1 / 60;
          host.update(1 / 60);
          locators.update();
        }
        assert.equal(host.ambient.players.get('gc_p01_081').state, 'finished');
        assert.ok(sounds.includes('Play_sfx_head_struck_01'));
        assert.ok(sounds.includes('Play_voice_ene_cry_f020'));
        walk(-2, 0, 3000);
        await exit();
        assert.equal(host.ambient.players.get('gc_p04_340').state, 'stopped');
        assert.ok(
          host.groups
            .filter((g: any) => g.demoActor?.player.name === 'gc_p04_340')
            .every((g: any) => !g.visible),
        );
        assert.equal(host.floor, 'f030');
        assert.equal(w._scene_photo_word(), 0x104, 'menu piece survives real stage transfer');
        assert.equal(host.completed, false);
        host.tick([...stepPlayer(w, 0, 0)].slice(0, 3), Math.PI, [0, 1]);
        walk(0, 2, 1890);
        walk(-2, 0, 1200);
        for (let i = 0; i < 360; i++) {
          time += 1 / 60;
          host.update(1 / 60);
          locators.update();
        }
        assert.equal(host.ambient.players.get('gc_p01_011').state, 'finished');
        walk(-2, 0, 1500);
        walk(2, 0, 900);
        for (let i = 0; i < 360; i++) {
          time += 1 / 60;
          host.update(1 / 60);
          locators.update();
        }
        walk(2, 0, 1100);
        for (let i = 0; i < 180; i++) {
          time += 1 / 60;
          host.update(1 / 60);
          locators.update();
        }
        assert.equal(host.ambient.players.get('gc_p01_020').state, 'finished');
        const bathDoors = scene.placements.filter((p: any) => p.name.includes('door002_bathroom'));
        assert.deepEqual(
          bathDoors
            .filter((p: any) => w._scene_model_visible(p.modelIndex))
            .map((p: any) => p.name.split('|').at(-1)),
          ['shsb_hous001_door002_bathroom_20'],
          'opening replaces the closed bathroom leaf',
        );
        for (const door of bathDoors) {
          const visible = !!w._scene_model_visible(door.modelIndex);
          assert.ok(
            host.groups
              .filter((g: any) => !g.stage && !g.demoActor && g.modelIndex === door.modelIndex)
              .every((g: any) => g.visible === visible),
            'renderer follows native door visibility',
          );
        }

        const scareTrap = Array.from({ length: w._trap_count() }, (_, n) => n).find((n) =>
          w.UTF8ToString(w._trap_name(n)).endsWith('f030_demo|6_trap_demo_gc_p01_021'),
        );
        const targetLocator = Array.from({ length: w._locator_count() }, (_, n) => n).find((n) =>
          w.UTF8ToString(w._locator_name(n)).endsWith('f030_demo|6_Locator_trap_check_dir'),
        );
        assert.notEqual(scareTrap, undefined);
        assert.notEqual(targetLocator, undefined);
        const trapMatrix = w._trap_box(scareTrap, 0) / 4;
        const feet = [...w.HEAPF32.slice(trapMatrix + 12, trapMatrix + 15)];
        feet[1] -= 0.8;
        const targetMatrix = w._locator_matrix(targetLocator) / 4;
        const foxYaw = Math.atan2(w.HEAPF32[targetMatrix + 8], w.HEAPF32[targetMatrix + 10]);
        const viewYaw = Math.atan2(Math.sin(foxYaw), -Math.cos(foxYaw));
        host.cameraPose = {
          camera: [feet[0], feet[1] + 1.6, feet[2]],
          yaw: viewYaw,
          pitch: 0,
          fov: 0.8,
        };
        host.tick(feet, viewYaw, [0, 0], false);
        host.tick(feet, viewYaw + Math.PI, [0, 0], true);
        assert.ok(!host.blocking.some((s: string) => s.includes('gc_p01_021')));
        host.tick(feet, viewYaw, [0, 0], false);
        host.tick(feet, viewYaw, [0, 0], true);
        assert.equal(host.ambient.players.get('gc_p01_021').state, 'playing');
        let sawLisa = false;
        let sawLightPulse = false;
        for (let i = 0; i < 1100; i++) {
          time += 1 / 60;
          host.update(1 / 60);
          locators.update();
          const scare = host.ambient.players.get('gc_p01_021');
          sawLisa ||= [...scare.models.values()].some(
            (actor: any) => actor.name.includes('och0') && actor.created && actor.visible,
          );
          sawLightPulse ||= [...scare.lights.values()].some(
            (light: any) => light.data[16] > 0 && light.data[18] > 1,
          );
        }
        assert.ok(sawLisa, 'Lisa is visible during the scare');
        assert.ok(sawLightPulse, 'scare lights reach the renderer');
        assert.equal(host.ambient.players.get('gc_p01_021').state, 'finished');
        assert.equal(host.ambient.players.get('gc_p01_010').state, 'finished');
        assert.equal(
          bathDoors.filter((p: any) => w._scene_model_visible(p.modelIndex)).length,
          1,
          'one static bathroom leaf after the slam',
        );
        const openLobby = scene.placements.find((p: any) => p.name.endsWith('_lobby_open'));
        assert.equal(w._scene_model_visible(openLobby.modelIndex), 1);
        assert.equal(w._scene_model_visible(lobby.modelIndex), 0);
        assert.equal(host.ambient.players.get('gc_p03_010').state, 'playing');
        assert.ok(
          commands.some(
            ([name, args]: any) => name === 'CallBGM' && args[0] === 'Play_bgm_unrest03',
          ),
        );
        assert.equal(host.unsupported.size, 0);
        assert.equal(host.floor, 'f030');
        walk(-2, 0, 4000);
        await exit();
        assert.equal(host.floor, 'f040');
        host.tick([...stepPlayer(w, 0, 0)].slice(0, 3), Math.PI, [0, 1]);
        walk(0, 2, 1890);
        walk(-2, 0, 4000);
        assert.equal(host.ambient.players.get('gc_p04_350').state, 'finished');
        assert.equal(host.unsupported.size, 0);
        assert.ok(
          scene.lights.some(
            (light: any) =>
              light.nativeSlot && light.name.includes('_light_ID30|') && light.data[16],
          ),
        );
        await exit();
        assert.equal(host.floor, 'f060');
        assert.equal(saves.read()?.floor, 'f060');
        assert.ok(
          f040Lights.has('ID20') && f040Lights.has('ID30'),
          'original light switch sequence',
        );
        assert.ok(
          f040Probes.has('ID20') && f040Probes.has('ID30'),
          'indirect lighting follows direct lighting',
        );
        assert.deepEqual([...f040Lisa].sort(), [false, true], 'Lisa appears and disappears');
        assert.deepEqual(
          [...f040Lamp].sort(),
          [0, 1],
          'native StageLight turns lamp off then on in f040',
        );
        assert.ok([...f040Cries].some((name) => name.includes('cry_s01')));
        assert.ok([...f040Cries].some((name) => name.includes('cry_l01')));
        assert.equal(host.ambient.players.get('gc_p03_010').state, 'stopped');
        assert.equal(host.unsupported.size, 0);
      } finally {
        locators.destroy();
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
      'three third-loop runs release native allocations',
    );
    console.log('Third-loop route: ' + JSON.stringify(measurements));
  },
);
