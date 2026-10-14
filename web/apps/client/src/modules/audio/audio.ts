import { Psarc, parseFpk, fpkEntry } from '../../lib/archives';
import { withEntry, withString } from '../gameplay/runtime';
import { loadDemoResources } from '../sequences/demo-resources';
// Subtitle times are driven by the audio marker, not by proximity or render frames.
export class SubtitleClock {
  declare active: any;
  declare visibility: any;

  constructor() {
    this.active = new Map();
    this.visibility = new Map();
  }
  notice(n: any) {
    if (n.kind === 1) {
      this.active.delete(n.playing);
      return;
    }
    if (n.lines.length) this.active.set(n.playing, n);
  }
  visible(id: any, on: any) {
    this.visibility.set(id, on);
  }
  clear() {
    this.active.clear();
  }
  text(time: any) {
    let text = '';
    for (const n of this.active.values()) {
      const t = time - n.time;
      if (t > n.lines.at(-1).end) {
        this.active.delete(n.playing);
        continue;
      }
      if (this.visibility.get(n.id) === false) continue;
      const line = n.lines.find((l: any) => t >= l.start && t < l.end);
      if (line) text = line.text;
      if (t > n.lines.at(-1).end) this.active.delete(n.playing);
    }
    return text;
  }
}
export async function prepareAudio(file: any, progress: any = () => {}, onError: any = () => {}) {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (ctx.sampleRate !== 48000) {
    await ctx.close();
    throw Error('El mezclador original necesita salida a 48 kHz');
  }
  const bgmStates = new Map(),
    pending = new Map(),
    clock = new SubtitleClock();
  let master;
  let serial = 0,
    node,
    closed = false,
    started = false,
    sequenceTime = null,
    bootstrap = [],
    peak = 0,
    radio = null;
  const send = (message: any, transfer: any = []) => node.port.postMessage(message, transfer);
  const request = (type: any, data: any = {}, transfer: any = []) =>
    new Promise((resolve: any, reject: any) => {
      const request = ++serial;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(Error('El audio no respondió: ' + type));
      }, 30000);
      pending.set(request, {
        resolve: (v: any) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e: any) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      send({ type, request, ...data }, transfer);
    });
  try {
    await ctx.audioWorklet.addModule(
      new URL(/* @vite-ignore */ './audio-worklet.js', import.meta.url),
    );
    const response = await fetch(new URL(/* @vite-ignore */ './audio-core.wasm', import.meta.url));
    if (!response.ok) throw Error('No se pudo cargar el núcleo de audio');
    const wasm = await response.arrayBuffer();
    const ready = new Promise((resolve: any, reject: any) => {
      const timer = setTimeout(() => reject(Error('El núcleo de audio no arrancó')), 30000);
      node = new AudioWorkletNode(ctx, 'pt-original-audio', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasm, seed: crypto.getRandomValues(new Uint32Array(1))[0] },
      });
      node.port.onmessage = ({ data: m }: any) => {
        if (m.type === 'ready') {
          clearTimeout(timer);
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          const e = Error(m.message);
          reject(e);
          for (const p of pending.values()) p.reject(e);
          pending.clear();
          onError(e);
        } else if (m.type === 'loaded' || m.type === 'started' || m.type === 'sequence') {
          pending.get(m.request)?.resolve(m);
          pending.delete(m.request);
        } else if (m.type === 'notice') clock.notice(m);
        else if (m.type === 'meter') peak = m.peak;
        else if (m.type === 'bgm') for (const [name, on] of m.states) bgmStates.set(name, on);
      };
      node.onprocessorerror = () => onError(Error('Se detuvo el procesador de audio'));
    });
    await ready;
    const archive = await new Psarc(file).open();
    for (const name of [
      'Init.bnk',
      'sys_resident.sbp',
      'bg_common.sbp',
      'sfx_common.sbp',
      'bgm_common.sbp',
    ]) {
      progress('Preparando audio original: ' + name);
      const bytes = (await archive.read('as/sh/sound/asset/' + name)).slice().buffer;
      await request('load', { name, bytes, package: Number(name.endsWith('.sbp')) }, [bytes]);
    }
    const languages = [...archive.names.keys()]
      .map(
        (n: any) =>
          n.match(/^as\/sh\/level\/ui\/subtitles\/EngVoice\/([A-Za-z]+)Text\/subtitle.fpk$/)?.[1],
      )
      .filter(Boolean);
    let language = languages.includes('Spa') ? 'Spa' : 'Eng',
      languageRevision = 0;
    const spanish = 'as/sh/level/ui/subtitles/EngVoice/SpaText/subtitle.fpk';
    const pkg = parseFpk(
        await archive.read('as/sh/level/ui/subtitles/EngVoice/' + language + 'Text/subtitle.fpk'),
      ),
      entry = pkg.entries.find((e: any) => e.name.endsWith('.subp'));
    if (!entry) throw Error('Falta la tabla original de subtítulos');
    const bytes = fpkEntry(pkg, entry.name).slice().buffer;
    await request('subtitles', { bytes }, [bytes]);
    master = ctx.createGain();
    node.connect(master);
    master.connect(ctx.destination);
    return {
      bgmStates,
      async prepareStream(name: any, data: any) {
        const bytes = data.slice().buffer;
        await request('stream-load', { name, bytes }, [bytes]);
      },
      playStream(name: any) {
        send({ type: 'stream-play', name });
      },
      setVolume(value: any, immediate: any = false) {
        const gain = Math.max(0, Math.min(1, value));
        master.gain.cancelScheduledValues(ctx.currentTime);
        if (immediate) master.gain.setValueAtTime(gain, ctx.currentTime);
        else master.gain.setTargetAtTime(gain, ctx.currentTime, 0.03);
      },
      languages,
      get language() {
        return language;
      },
      async setLanguage(value: any) {
        if (!languages.includes(value)) throw Error('Subtítulos no disponibles');
        const revision = ++languageRevision;
        const pack = parseFpk(
            await archive.read('as/sh/level/ui/subtitles/EngVoice/' + value + 'Text/subtitle.fpk'),
          ),
          entry = pack.entries.find((e: any) => e.name.endsWith('.subp'));
        if (!entry) throw Error('Tabla de subtítulos ausente');
        const bytes = fpkEntry(pack, entry.name).slice().buffer;
        if (revision !== languageRevision || closed) return;
        clock.clear();
        await request('subtitles', { bytes }, [bytes]);
        language = value;
      },
      clock,
      get time() {
        return ctx.currentTime;
      },
      get peak() {
        return peak;
      },
      get active() {
        return started && ctx.state === 'running';
      },
      get sequenceSeconds() {
        return sequenceTime === null ? null : Math.max(0, ctx.currentTime - sequenceTime);
      },
      async resume() {
        if (closed) return;
        await ctx.resume();
        if (!started) {
          await request('start');
          started = true;
          for (const c of bootstrap) this.command(...c);
          bootstrap = [];
        }
      },
      pause() {
        if (!closed) return ctx.suspend();
      },
      command(name: any, args: any) {
        if (name === 'VisibleControlSubtitle') {
          clock.visible(args[0], args[1] === '1');
          return true;
        }
        const bgm = name === 'CallBGM' || name === 'StopBGM';
        if (name !== 'SoundPostEvent' && !bgm) return false;
        if (!started) {
          bootstrap.push([name, args]);
          return true;
        }
        const spatial = args.length >= 4,
          position = spatial ? args.slice(1, 4).map(Number) : [0, 0, 0];
        if (spatial && /^Play_radio_/.test(args[0])) radio = position;
        if (bgm) bgmStates.set(args[0].replace(/^Stop_/, 'Play_'), name === 'CallBGM' ? 1 : 0);
        send({ type: 'post', name: args[0], position, spatial, bgm });
        return true;
      },
      get radio() {
        return radio;
      },
      ambience(area: any) {
        if (started) send({ type: 'ambience', area });
      },
      sources(items: any) {
        if (started) send({ type: 'sources', items });
      },
      acoustics(objects: any) {
        if (started) send({ type: 'acoustics', objects });
      },
      postId(id: number) {
        if (started) send({ type: 'post-id', id });
      },
      footstep(left: any, surface: any, position: any) {
        if (started) send({ type: 'footstep', left, surface, position });
      },
      listener(position: any, forward: any) {
        if (started) send({ type: 'listener', position, forward });
      },
      effect(key: any, node: any, position: any, spatial: any = {}) {
        if (!started) throw Error('Audio de secuencias todavía no activo');
        send({ type: 'effect', key, node, position, ...spatial });
      },
      releaseEffects(prefix: any) {
        if (started) send({ type: 'effects-release', prefix });
      },
      async sequence(events: any) {
        sequenceTime = null;
        const sounds = events
          .filter((e: any) => e.soundId)
          .map((e: any) => ({ id: e.soundId, seconds: e.frame / (60000 / 1001) }));
        const reply: any = await request('sequence', { events: sounds });
        sequenceTime = reply.contextTime;
      },
      finish() {
        clock.clear();
        sequenceTime = null;
      },
      async destroy() {
        if (closed) return;
        closed = true;
        bootstrap = [];
        clock.clear();
        for (const p of pending.values()) p.reject(Error('Audio cerrado'));
        pending.clear();
        send({ type: 'dispose' });
        node.disconnect();
        master?.disconnect();
        await ctx.close();
      },
    };
  } catch (e) {
    node?.disconnect();
    await ctx.close();
    throw e;
  }
}

// Environment updates are independent of the native animation contact queue.
export class HallwayAcoustics {
  declare w: any;
  declare audio: any;
  declare elapsed: any;
  declare blocked: any;
  declare steps: any;
  declare zone: any;
  declare material: any;
  declare ambience: any;

  constructor(w: any, audio: any) {
    this.w = w;
    this.audio = audio;
    this.elapsed = 0;
    this.blocked = 0;
    this.steps = 0;
    this.zone = '';
    this.material = 0;
    this.ambience = new SceneAmbience(w, audio);
  }
  reset() {
    this.elapsed = 0;
  }
  contact(left: any, position: any) {
    if (!this.audio.active) return;
    const area = this.area(position);
    this.audio.acoustics([{ object: 2, sends: area.sends }]);
    this.audio.footstep(left, this.w._acoustic_surface(...position), position);
    this.steps++;
  }
  area(position: any) {
    const w = this.w,
      n = w._acoustic_area(...position),
      name = w.UTF8ToString(w._acoustic_area_name()),
      sends = [];
    if (n > 16) throw Error('Demasiados envíos acústicos');
    for (let i = 0; i < n; i++)
      sends.push({ bus: w.UTF8ToString(w._acoustic_bus(i)), level: w._acoustic_level(i) });
    return { name, sends };
  }
  update(position: any, grounded: any, listener: any, dt: any, walking: any) {
    if (!this.audio.active) return;
    this.elapsed += dt;
    if (this.elapsed >= 0.05) {
      const elapsed = this.elapsed;
      this.elapsed = 0;
      const player = this.area(position);
      this.zone = player.name;
      this.material = this.w._acoustic_surface(...position);
      const objects: { object: number; sends: any[]; obstruction?: number; occlusion?: number }[] =
        [{ object: 2, sends: player.sends }];
      const radio = this.audio.radio;
      if (radio) {
        // Native game does not submit radio obstruction commands. Preserve bank distance curves.
        this.blocked = 0;
        objects.push({
          object: 1,
          sends: this.area(radio).sends,
          obstruction: this.blocked,
          occlusion: 0,
        });
      }
      this.audio.acoustics(objects);
    }
  }
}

// Original SoundSource range hysteresis; scenery starts only when its session is active.
export class SceneSoundSources {
  declare w: any;
  declare audio: any;
  declare elapsed: any;
  declare sources: any;

  constructor(w: any, audio: any) {
    this.w = w;
    this.audio = audio;
    this.elapsed = 0;
    this.sources = Array.from({ length: w._acoustic_source_count() }, (_: any, i: any) => ({
      index: i,
      name: w.UTF8ToString(w._acoustic_source_name(i)),
      event: w.UTF8ToString(w._acoustic_source_event(i)),
      on: false,
    }));
  }
  update(listener: any, dt: any) {
    if (!this.audio.active || dt <= 0) return;
    this.elapsed += dt;
    if (this.elapsed < 0.05) return;
    this.elapsed = 0;
    const items = [],
      objects: any[] = [];
    for (const s of this.sources) {
      const p = this.w._acoustic_source_data(s.index, ...listener) / 4,
        v = Array.from<number>(this.w.HEAPF32.slice(p, p + 7)),
        position = v.slice(0, 3),
        distance = Math.hypot(...position.map((x: any, i: any) => x - listener[i]));
      const on = distance <= v[6] || (s.on && distance <= v[6] * 1.05);
      if (!on && !s.on) continue;
      s.on = on;
      items.push({
        index: s.index,
        name: s.event,
        position,
        forward: v.slice(3, 6),
        enabled: on,
        fade: 0.5,
      });
      if (on) {
        const n = this.w._acoustic_area(...position),
          sends = [];
        for (let i = 0; i < n; i++)
          sends.push({
            bus: this.w.UTF8ToString(this.w._acoustic_bus(i)),
            level: this.w._acoustic_level(i),
          });
        objects.push({ object: 512 + s.index, sends });
      }
    }
    this.audio.sources(items);
    this.audio.acoustics(objects);
  }
}

// Prime the destination without exposing its startup events before publication.
// Cancellation or a pause during resume must not leave a hidden context playing.
export async function primeStageAudio(audio: any, playing: any, isCurrent: any, isPlaying: any) {
  audio.setVolume(0, true);
  try {
    if (playing) await audio.resume();
  } catch (error) {
    await audio.pause();
    throw error;
  }
  if (!isCurrent()) {
    await audio.pause();
    return false;
  }
  if (!isPlaying()) await audio.pause();
  return true;
}

// Stage::Body visibility is read live after Lua has changed Visible/Invisible.
export async function prepareLocatorSounds(w: any, scene: any, file: any, audio: any) {
  const resources = await loadDemoResources(w, file),
    cache = new Map(),
    items = [],
    unresolved = [];
  for (let i = 0, n = w._fx_locator_count(); i < n; i++) {
    const path = w.UTF8ToString(w._fx_locator_path(i));
    if (!path) continue;
    if (!cache.has(path)) {
      const read = scene.entries.get(path) || resources.entries.get(path);
      if (!read) throw Error('Falta efecto original: ' + path);
      const effect = withEntry(w, read(), path, (p: any, n: any) => {
        const result = w._effect_nodes_json(p, n);
        if (!result) throw Error('Efecto inválido: ' + path);
        return JSON.parse(w.UTF8ToString(result));
      });
      cache.set(path, effect);
    }
    const effect = cache.get(path);
    if (
      effect.nodes.some((n: any) => !['FxModuleGraph', 'FxSoundCallProgramEffectNode'].includes(n))
    )
      unresolved.push(path);
    if (effect.sound?.play) items.push({ index: i, node: effect.sound, visible: false });
    else if (path.includes('/sound/')) throw Error('Nodo de sonido original sin resolver: ' + path);
  }
  return new LocatorSounds(w, audio, items, unresolved);
}
export class LocatorSounds {
  declare w: any;
  declare audio: any;
  declare items: any;
  declare unresolved: any;
  declare destroyed: any;

  constructor(w: any, audio: any, items: any, unresolved: any = []) {
    this.w = w;
    this.audio = audio;
    this.items = items;
    this.unresolved = [...new Set(unresolved)];
    this.destroyed = false;
  }
  update() {
    if (this.destroyed || !this.audio.active) return;
    const w = this.w;
    for (const item of this.items) {
      const p = w._fx_locator_state(item.index) / 4,
        v = Array.from<number>(w.HEAPF32.slice(p, p + 7)),
        visible = !!v[6],
        key = 'locator:' + item.index + ':';
      if (visible === item.visible) continue;
      item.visible = visible;
      if (!visible) {
        this.audio.releaseEffects(key);
        continue;
      }
      const position = v.slice(0, 3),
        n = w._acoustic_area(...position),
        sends = [];
      for (let i = 0; i < n; i++)
        sends.push({ bus: w.UTF8ToString(w._acoustic_bus(i)), level: w._acoustic_level(i) });
      this.audio.effect(key, item.node, position, { forward: v.slice(3, 6), sends });
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const item of this.items)
      if (item.visible) this.audio.releaseEffects('locator:' + item.index + ':');
    this.items = [];
  }
}

// Area ambience is evaluated at the camera, not the feet or the radio emitter.
export class SceneAmbience {
  declare w: any;
  declare audio: any;
  declare area: any;

  constructor(w: any, audio: any) {
    this.w = w;
    this.audio = audio;
    this.area = null;
  }
  update(listener: any, dt: any) {
    if (!this.audio.active || dt <= 0 || !this.w._acoustic_ambience) return;
    const w = this.w;
    w._acoustic_area(...listener);
    const name = w.UTF8ToString(w._acoustic_area_name());
    if (name === this.area) return;
    const area = withString(w, this.area || '', (p: any) =>
      JSON.parse(w.UTF8ToString(w._acoustic_ambience(p))),
    );
    this.audio.ambience(area);
    this.area = name;
  }
}
