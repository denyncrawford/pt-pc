import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createAudio from '../../../packages/engine-wasm/dist/audio-core.js';
import createGeometry from '../../../packages/engine-wasm/dist/geometry.js';
import { Psarc, parseFpk, fpkEntry } from '../src/lib/archives';
import { withEntry, withString } from '../src/modules/gameplay/runtime';
import { SubtitleClock, HallwayAcoustics } from '../src/modules/audio/audio';
test('subtitles follow marker time, visibility windows and the sound lifetime', () => {
  const c = new SubtitleClock(),
    n = {
      kind: 0,
      playing: 1,
      id: 'radio',
      time: 10,
      lines: [
        { start: 1, end: 2, text: 'first' },
        { start: 3, end: 4, text: 'second' },
      ],
    };
  c.notice(n);
  assert.equal(c.text(10.9), '');
  assert.equal(c.text(11), 'first');
  c.visible('radio', false);
  assert.equal(c.text(11.5), '');
  c.visible('radio', true);
  assert.equal(c.text(13.5), 'second', 'entering range does not restart captions');
  c.notice({ kind: 1, playing: 1 });
  assert.equal(c.text(13.6), '');
  c.notice(n);
  c.clear();
  assert.equal(c.text(11), '');
});
test(
  'local native audio: original radio, Spanish marker table, directional mix and stop',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const w = await createAudio({
        wasmBinary: readFileSync(
          new URL('../../../packages/engine-wasm/dist/audio-core.wasm', import.meta.url),
        ),
      }),
      a = await new Psarc(Bun.file(process.env.PT_TEST_PSARC)).open();
    w._audio_reset();
    const bytes = (b: any, fn: any) => {
      const p = w._malloc(b.length);
      try {
        w.HEAPU8.set(b, p);
        return fn(p, b.length);
      } finally {
        w._free(p);
      }
    };
    assert.equal(
      bytes(new Uint8Array(8), (p: any, n: any) =>
        withString(w, 'bad', (s: any) => w._audio_load(s, p, n, 1)),
      ),
      0,
    );
    w._audio_reset();
    for (const name of [
      'Init.bnk',
      'sys_resident.sbp',
      'bg_common.sbp',
      'sfx_common.sbp',
      'bgm_common.sbp',
    ])
      assert.equal(
        bytes(await a.read('as/sh/sound/asset/' + name), (p: any, n: any) =>
          withString(w, name, (s: any) => w._audio_load(s, p, n, Number(name.endsWith('.sbp')))),
        ),
        1,
      );
    for (const name of [...a.names.keys()].filter((n: any) =>
      /^as\/sh\/level\/ui\/subtitles\/EngVoice\/[A-Za-z]+Text\/subtitle.fpk$/.test(n),
    )) {
      const pack = parseFpk(await a.read(name)),
        entry = pack.entries.find((e: any) => e.name.endsWith('.subp'));
      assert.ok(entry, name);
      assert.equal(
        bytes(fpkEntry(pack, entry.name), (p: any, n: any) => w._audio_subtitles(p, n)),
        1,
        name,
      );
    }
    const pkg = parseFpk(await a.read('as/sh/level/ui/subtitles/EngVoice/SpaText/subtitle.fpk')),
      entry = pkg.entries.find((e: any) => e.name.endsWith('.subp'));
    assert.equal(
      bytes(fpkEntry(pkg, entry.name), (p: any, n: any) => w._audio_subtitles(p, n)),
      1,
    );
    assert.equal(w._audio_start(), 1, w.UTF8ToString(w._audio_error()));
    const openingResident = parseFpk(await a.read('as/sh/level/common/resident.fpk'));
    const demo = fpkEntry(openingResident, '/Assets/sh/demo/demo_stream/gc_p00_020.fsm');
    assert.equal(
      bytes(demo, (p: any, n: any) =>
        withString(w, 'opening', (s: any) => w._audio_stream_load(s, p, n)),
      ),
      1,
      'opening contains original embedded WEM',
    );
    assert.ok(
      withString(w, 'opening', (s: any) => w._audio_stream_play(s)),
      'native external source event starts',
    );
    let openingPower = 0;
    for (let t = 0; t < 8 * 48000; t += 256) {
      const p = w._audio_render(256) / 4;
      for (let i = 0; i < 512; i++) {
        assert.ok(Number.isFinite(w.HEAPF32[p + i]));
        openingPower += w.HEAPF32[p + i] ** 2;
      }
    }
    assert.ok(openingPower > 0, 'stand-up audio produces non-silent PCM');
    w._audio_stop();
    for (let i = 0; i < 400; i++) w._audio_render(256);
    assert.equal(w._audio_schedule(0xe4b855b2, 0), 1, 'native photo collection sound exists');
    let photoPower = 0;
    for (let t = 0; t < 2 * 48000; t += 256) {
      const p = w._audio_render(256) / 4;
      for (let i = 0; i < 512; i++) photoPower += w.HEAPF32[p + i] ** 2;
    }
    assert.ok(photoPower > 0, 'photo collection sound produces PCM');
    w._audio_stop();
    for (let i = 0; i < 400; i++) w._audio_render(256);
    assert.equal(w._audio_schedule(0, 1), 0);
    assert.equal(w._audio_render(3000), 0);
    const g = await createGeometry({
        wasmBinary: readFileSync(
          new URL('../../../packages/engine-wasm/dist/geometry.wasm', import.meta.url),
        ),
      }),
      resident = parseFpk(await a.read('as/sh/level/common/resident.fpk')),
      path = '/Assets/sh/demo/demo_stream/gc_p00_010.fsm';
    assert.equal(
      withEntry(g, fpkEntry(resident, path), path, (p: any, n: any) => g._sequence_load(p, n)),
      128,
    );
    const cues = Array.from({ length: g._sequence_event_count() }, (_: any, i: any) => ({
      id: g._sequence_event_sound(i),
      frame: g._sequence_event_start(i),
    })).filter((e: any) => e.id);
    assert.deepEqual(
      cues.map((e: any) => e.frame),
      [1, 4, 35, 67],
    );
    for (const e of cues)
      assert.equal(
        w._audio_schedule(e.id, 0.25 + e.frame / (60000 / 1001)),
        1,
        'original sequence event exists in loaded banks',
      );
    const render = (seconds: any, onNotice: any = () => {}) => {
      const power = [0, 0];
      let left = Math.round(seconds * 48000);
      while (left) {
        const n = Math.min(left, 256),
          p = w._audio_render(n) / 4;
        assert.ok(p);
        for (let i = 0; i < n * 2; i++) {
          const v = w.HEAPF32[p + i];
          assert.ok(Number.isFinite(v));
          power[i % 2] += v * v;
        }
        for (let j = 0, k = w._audio_notifications(); j < k; j++) onNotice(j);
        left -= n;
      }
      return power;
    };
    assert.deepEqual(render(0.2), [0, 0], 'scheduled cue does not play early');
    assert.ok(render(2).reduce((a: any, b: any) => a + b) > 0, 'door sequence produces PCM');
    w._audio_stop();
    render(2);
    w._audio_listener(-8, 0, 7, 0, 0, -1);
    assert.ok(
      withString(w, 'Play_radio_f010', (p: any) =>
        w._audio_post(p, -8.635407, -0.299998, 6.400008, 1),
      ),
    );
    let lines = 0;
    const power = render(8, (j: any) => {
      if (w._audio_notice_kind(j) === 0) {
        const marker = w.UTF8ToString(w._audio_marker(j));
        lines = withString(w, marker, (p: any) => w._audio_caption(p));
        assert.equal(w.UTF8ToString(w._audio_caption_id()), 'tria1000_101010');
        assert.equal(lines, 15);
        const text = Array.from({ length: lines }, (_: any, i: any) =>
          w.UTF8ToString(w._audio_caption_text(i)),
        ).join(' ');
        assert.ok(text.includes('policía'));
        assert.ok(!text.includes('�'));
        for (let i = 0; i < lines; i++) {
          assert.ok(w._audio_caption_end(i) > w._audio_caption_start(i));
          assert.ok(w.UTF8ToString(w._audio_caption_text(i)).length);
        }
      }
    });
    assert.equal(lines, 15);
    assert.ok(power[0] > power[1] * 2, 'native spatial panning favors the radio side');
    w._audio_listener(-8, 0, 7, 0, 0, 1);
    const reversed = render(8);
    assert.ok(reversed[1] > reversed[0] * 2, 'rotating listener reverses the stereo image');
    assert.ok(withString(w, 'Stop_radio_f010', (p: any) => w._audio_post(p, 0, 0, 0, 0)));
    render(2);
    assert.ok(render(1).reduce((a: any, b: any) => a + b) < 0.001, 'stop trap silences radio');
    assert.ok(w._audio_footstep(1, 0x59d11af1, -8, -1.4, 7));
    assert.ok(
      render(0.6).reduce((a: any, b: any) => a + b) > 0,
      'original tile footstep produces PCM',
    );
    assert.ok(w._audio_footstep(0, 0x4fb17187, -8, -1.4, 7));
    assert.ok(
      render(0.6).reduce((a: any, b: any) => a + b) > 0,
      'original stair footstep produces PCM',
    );
    w._audio_stop();
    render(2);
    w._audio_listener(0, 0, 0, 0, 0, -1);
    for (const [name, object, fade, curve] of [
      ['Play_sfx_digiclock_tick_solo', 16, 0.05, 5],
      ['Play_sfx_head_struck_02', 17, 0.02, 4],
    ]) {
      const playing = withString(w, name, (p: any) => w._audio_effect(p, object, 0, 0, -1));
      assert.ok(playing, 'original effect bank event');
      assert.ok(render(0.1).reduce((a: any, b: any) => a + b) > 0, 'original effect produces PCM');
      w._audio_effect_release(playing, object, fade, curve, 1);
      render(1);
      assert.equal(
        w._audio_effect_collect(playing, object),
        1,
        'sound emitter released after fade',
      );
    }
    w._audio_stop();
    render(2);
    for (const [index, name] of [
      'Play_sfx_light_hum_01',
      'Play_sfx_rainfall_01',
      'Play_sfx_rainfall_window_01',
      'Play_sfx_rainfall_window_02',
      'Play_sfx_rainfall_window_03',
    ].entries()) {
      const start = () =>
        withString(w, name, (p: any) => w._audio_source(index, p, 0, 0, -1, 0, 0, 1, 1, 0));
      const id = start();
      assert.ok(id, name);
      assert.ok(render(2).reduce((a: any, b: any) => a + b) > 0, name + ' produces PCM');
      assert.equal(start(), id, 'update must not restart a live loop');
      withString(w, name, (p: any) => w._audio_source(index, p, 0, 0, -1, 0, 0, 1, 0, 0.5));
      render(2);
      assert.ok(
        render(1).reduce((a: any, b: any) => a + b) < 0.001,
        name + ' stops after leaving range',
      );
    }
    for (const name of [
      'Play_sfx_water_drop_b',
      'Play_sfx_wall_light_hum_01',
      'Play_sfx_passage_light_hum_04',
      'Play_sfx_passage_light_hum_08',
      'Play_sfx_head_struck_01',
      'Play_voice_ene_cry_f020',
    ]) {
      w._audio_stop();
      render(2);
      const playing = withString(w, name, (p: any) => w._audio_effect(p, 24, 0, 0, -1));
      assert.ok(playing, name);
      w._audio_effect_transform(24, 0, 0, -1, 0, 0, 1);
      if (name === 'Play_sfx_water_drop_b')
        console.log(
          'WATER SOURCES',
          withString(w, name, (p: any) => w.UTF8ToString(w._audio_event_sources(p))),
        );
      const power = render(10).reduce((a: any, b: any) => a + b);
      assert.ok(Number.isFinite(power));
      if (name !== 'Play_sfx_water_drop_b') assert.ok(power > 0, name + ' produces original PCM');
      console.log('LOCATOR PCM', name, power);
      w._audio_effect_release(playing, 24, 0.3, 4, 1);
      render(2);
      assert.equal(w._audio_effect_alive(playing), 0);
      assert.equal(w._audio_effect_collect(playing, 24), 1);
    }
    // The original bathroom ambience changes global RTPC 2556335218. Preserve it,
    // then stop the ambience so the energy assertion measures only the drop.
    w._audio_stop();
    render(2);
    assert.ok(withString(w, 'Play_bg_bathroom01', (p: any) => w._audio_post(p, 0, 0, 0, 0)));
    render(0.1);
    w._audio_stop();
    render(2);
    assert.ok(withString(w, 'Play_sfx_water_drop_b', (p: any) => w._audio_effect(p, 25, 0, 0, -1)));
    const bathroomDrop = render(4).reduce((a: any, b: any) => a + b);
    assert.ok(bathroomDrop > 0, 'bathroom event unmutes the ORIGINAL water drop');
    console.log('BATHROOM DROP PCM', bathroomDrop);
    w._audio_stop();
    render(2);
    const ambience = (name: any) =>
      withString(w, name, (e: any) =>
        withString(w, 'volumeRtpc', (v: any) =>
          withString(w, '', (r: any) => w._audio_ambience(e, v, r, 0, 1)),
        ),
      );
    assert.equal(ambience('Play_bg_bathroom01'), 1);
    render(1);
    assert.equal(w._audio_ambient_count(), 1);
    assert.equal(ambience('Play_bg_startroom01'), 1);
    assert.equal(w._audio_ambient_count(), 2);
    render(1.1);
    assert.equal(w._audio_ambient_count(), 1);
    assert.equal(ambience(''), 1);
    render(1.1);
    assert.equal(w._audio_ambient_count(), 0, 'faded ambience releases emitter');
    // Sound IDs are read from CeilLamp/CeilLampStrong GANI events, not guessed hum names.
    for (const id of [3728713854, 3728713853, 1393560187, 1393560184]) {
      w._audio_stop();
      render(2);
      w._audio_listener(-8.2, 0, 7.5, 0, 0, 1);
      assert.ok(w._audio_effect_id(id, 26, -8.28, 1.7, 8.1), 'lamp motion spatial cue exists');
      const power = render(2).reduce((a: any, b: any) => a + b);
      assert.ok(power > 0, 'original lamp cue produces PCM');
      console.log('LAMP MOTION PCM', id, power);
    }
    console.log('Original radio, 15 Spanish lines and 4 sample-scheduled door cues validated');
  },
);

test('acoustic footsteps consume animation contacts and respect pause', () => {
  const events = [],
    w = {
      _acoustic_area: () => 0,
      _acoustic_area_name: () => 0,
      UTF8ToString: () => '',
      _acoustic_surface: () => 0x59d11af1,
    },
    audio = { active: true, acoustics: () => {}, footstep: (...args: any) => events.push(args) },
    a = new HallwayAcoustics(w, audio);
  for (let i = 0; i < 40; i++) a.update([i, 0, 0], true, [i, 1.6, 0], 0.05, true);
  assert.equal(events.length, 0, 'travel alone never synthesizes a contact');
  a.contact(false, [0, 0, 0]);
  a.contact(true, [0, 0, 0]);
  assert.deepEqual(
    events.map((e: any) => e[0]),
    [false, true],
  );
  audio.active = false;
  a.contact(true, [0, 0, 0]);
  assert.equal(events.length, 2);
  a.reset();
  assert.equal(events.length, 2);
});

test('radio keeps native distance attenuation without a synthetic binary obstruction jump', () => {
  const updates = [];
  const w = {
    _acoustic_area: () => 0,
    _acoustic_area_name: () => 0,
    UTF8ToString: () => '',
    _acoustic_surface: () => 0,
    _acoustic_blocked: () => {
      throw Error('Radio must not add an unverified obstruction ray');
    },
  };
  const audio = {
    active: true,
    radio: [-8.63, -0.3, 6.4],
    acoustics: (objects: any) => updates.push(objects),
  };
  const a = new HallwayAcoustics(w, audio);
  for (const x of [0, -1, -3, -5, -7, -8])
    a.update([x, -1.4, 7.5], true, [x, 0.2, 7.5], 0.05, true);
  assert.equal(updates.length, 6);
  for (const objects of updates) {
    const radio = objects.find((o: any) => o.object === 1);
    assert.equal(radio.obstruction, 0);
    assert.equal(radio.occlusion, 0);
  }
});

test('scene sources keep native range hysteresis and do not start during preload/pause', async () => {
  const { SceneSoundSources } = await import('../src/modules/audio/audio');
  const commands = [],
    v = new Float32Array([0, 0, 0, 0, 0, 0, 1, 10]);
  const w = {
    HEAPF32: v,
    _acoustic_source_count: () => 1,
    _acoustic_source_name: () => 0,
    _acoustic_source_event: () => 0,
    UTF8ToString: () => 'source',
    _acoustic_source_data: () => 4,
    _acoustic_area: () => 0,
  };
  const audio = { active: false, sources: (s: any) => commands.push(s), acoustics: () => {} };
  const s = new SceneSoundSources(w, audio);
  s.update([0, 0, 0], 1);
  assert.equal(commands.length, 0);
  audio.active = true;
  s.update([0, 0, 0], 0);
  assert.equal(commands.length, 0);
  for (const x of [9, 10.3, 10.6, 10.3, 9]) s.update([x, 0, 0], 0.05);
  assert.deepEqual(
    commands.map((c: any) => c.map((s: any) => s.enabled)),
    [[true], [true], [false], [], [true]],
  );
});

test(
  'PKG scenery declares fluorescent hum and four original rain sources',
  { skip: !process.env.PT_TEST_PSARC },
  async () => {
    const { loadHallway } = await import('../src/modules/gameplay/runtime');
    for (const [kind, expected] of [
      ['start', ['Play_sfx_light_hum_01']],
      [
        'hallway',
        [
          'Play_sfx_rainfall_01',
          'Play_sfx_rainfall_window_01',
          'Play_sfx_rainfall_window_02',
          'Play_sfx_rainfall_window_03',
        ],
      ],
    ]) {
      const w = await createGeometry({
        wasmBinary: readFileSync(
          new URL('../../../packages/engine-wasm/dist/geometry.wasm', import.meta.url),
        ),
      });
      await loadHallway(w, Bun.file(process.env.PT_TEST_PSARC), () => {}, { scripts: true, kind });
      const events = Array.from({ length: w._acoustic_source_count() }, (_: any, i: any) =>
        w.UTF8ToString(w._acoustic_source_event(i)),
      );
      assert.deepEqual(events, expected);
      for (let i = 0; i < events.length; i++) {
        const p = w._acoustic_source_data(i, 0, 1.65, 0) / 4,
          v = [...w.HEAPF32.slice(p, p + 7)];
        assert.ok(v.every(Number.isFinite));
        assert.ok(v[6] > 0);
        assert.ok(Math.abs(Math.hypot(...v.slice(3, 6)) - 1) < 1e-5);
      }
    }
  },
);
