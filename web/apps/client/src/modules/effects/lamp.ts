import { Psarc, unwrap } from '../../lib/archives';
import { withEntry, withString } from '../gameplay/runtime';
import { loadDemoResources } from '../sequences/demo-resources';
import { readSkin } from '../player/player-body';
import { readMaterials } from '../renderer/materials';
import { multiply } from '../renderer/lighting';
import { transformPoint } from '../gameplay/first-loop';

// FloorLevel's lamp states. This selects a clip; ordinary hallway transfers do not restart it.
export function lampMotionForFloor(floor: any) {
  if (['f100', 'f110'].includes(floor)) return 'CeilLampStrong';
  return ['f005', 'f010', 'f020', 'f030', 'f040', 'f050', 'f060', 'f070', 'f120', 'f160'].includes(
    floor,
  )
    ? 'CeilLamp'
    : null;
}
export async function prepareLamp(w: any, scene: any, file: any, audio: any) {
  const locator = w._lamp_locator();
  if (!locator) return null;
  const world = w.HEAPF32.slice(locator / 4, locator / 4 + 16),
    resources = await loadDemoResources(w, file),
    archive = await new Psarc(file).open();
  const setup = new TextDecoder().decode(
    unwrap(await archive.read('as/sh/level_asset/chara/gimmick/ShGimmickSetUp.lua')),
  );
  const paths = new Map(
    [
      ...setup.matchAll(
        /Gimmick\.AddMotionPath\{\s*key\s*=\s*"([^"]+)"\s*,\s*path\s*=\s*"([^"]+)"/g,
      ),
    ].map((m: any) => [m[1], m[2]]),
  );
  const mtar = '/Assets/sh/motion/mtar/gimmick/ShGimmick_layers.mtar',
    model = '/Assets/sh/chara/lte/Scenes/lte0_main0_def.fmdl',
    clips = new Map();
  w._lamp_clear();
  try {
    withEntry(w, resources.read(mtar), mtar, (p: any, n: any) => {
      if (!w._lamp_archive(p, n)) throw Error('Invalid original lamp animations');
    });
    withEntry(w, resources.read(model), model, (p: any, n: any) => {
      if (!w._lamp_model(p, n)) throw Error('Invalid original lamp skeleton');
    });
    for (const key of ['CeilLamp', 'CeilLampStrong']) {
      const path = paths.get(key);
      if (!path) throw Error('Missing original motion ' + key);
      const clip = withEntry(w, resources.read(mtar), mtar, (p: any, n: any) =>
        withString(w, path, (k: any) => {
          const value = w._gimmick_audio_json(p, n, k);
          if (!value) throw Error('Invalid motion ' + key);
          return JSON.parse(w.UTF8ToString(value));
        }),
      );
      if (!withString(w, path, (p: any) => w._lamp_motion(p)))
        throw Error('Unsupported lamp rig ' + key);
      clip.path = path;
      clip.events = clip.events
        .map((e: any) => {
          if (e.args[0] !== 6 || e.args.length !== 2)
            throw Error('Unsupported required lamp event');
          if (!w._lamp_sample(e.frame)) throw Error('Invalid original lamp pose');
          const bone = withString(w, e.bone, (p: any) => w._lamp_bone(p));
          if (!bone) throw Error('Missing original lamp sound bone');
          const position = transformPoint(world, w.HEAPF32.slice(bone / 4 + 12, bone / 4 + 15));
          const sends = [];
          for (let i = 0, n = w._acoustic_area(...position); i < n; i++)
            sends.push({ bus: w.UTF8ToString(w._acoustic_bus(i)), level: w._acoustic_level(i) });
          return { ...e, event: e.args[1] >>> 0, position, sends };
        })
        .sort((a: any, b: any) => a.frame - b.frame);
      clips.set(key, clip);
    }
    const parts = '/Assets/sh/parts/chara/lte/lte0_main0_def_v00.parts';
    const effectPath = withEntry(w, resources.read(parts), parts, (p: number, n: number) => {
      const result = w._lamp_effect_parts(p, n);
      if (!result) throw Error('Invalid original lamp light connection');
      return w.UTF8ToString(result) as string;
    });
    withEntry(w, resources.read(effectPath), effectPath, (p: number, n: number) => {
      if (!w._lamp_effect_load(p, n)) throw Error('Invalid original lamp light effect');
    });
    const flare = '/Assets/sh/effect/vfx_data/lensflare/fx_sh_lfrlgt01.vfxlf';
    withEntry(w, resources.read(flare), flare, (p: number, n: number) =>
      withString(w, flare, (name: number) => w._lamp_effect_dependency(name, p, n)),
    );
    const light = { name: 'CeilLampFlareLight', data: new Float32Array(28), dynamic: true };
    // Native preset slots retain their own array; they must not clear the VFX slot.
    scene.lights = [...scene.lights];
    const lightIndex = scene.baseLightingCounts?.lights ?? scene.lights.length;
    scene.lights.splice(lightIndex, 0, light);
    if (scene.baseLightingCounts) scene.baseLightingCounts.lights++;
    const visual = appendGimmickMesh(w, scene, resources.read(model), model, world);
    const setEnabled = visual.setEnabled;
    let lightEnabled = true;
    visual.setEnabled = (enabled: boolean) => {
      lightEnabled = enabled;
      light.data[16] = Number(enabled && w._lamp_stage_light() === 1);
      setEnabled(enabled);
    };
    const player = new LampPlayer(
      clips,
      audio,
      (clip: any, frame: any, dt = 0) => {
        withString(w, clip.path, (p: any) => w._lamp_motion(p));
        if (!w._lamp_sample(frame)) throw Error('Could not evaluate the lamp');
        setEnabled(lightEnabled);
        visual.sample();
        const ptr = w._malloc(64);
        try {
          w.HEAPF32.set(world, ptr / 4);
          const value = w._lamp_effect_sample(ptr, Math.min(dt, 0.25));
          if (!value) throw Error('Could not evaluate the original lamp light');
          light.data.set(w.HEAPF32.subarray(value / 4, value / 4 + 28));
          light.data[16] = Number(lightEnabled && w._lamp_stage_light() === 1);
        } finally {
          w._free(ptr);
        }
      },
      () => w._lamp_clear(),
    );
    player.visual = visual;
    player.sample(clips.get('CeilLamp'), 0);
    return player;
  } catch (error) {
    w._lamp_clear();
    throw error;
  }
}
export class LampPlayer {
  declare visual: any;
  declare clips: any;
  declare audio: any;
  declare sample: any;
  declare clear: any;
  declare motion: any;
  declare frame: any;
  declare lastTime: any;
  declare serial: any;
  declare destroyed: any;

  constructor(clips: any, audio: any, sample: any = () => {}, clear: any = () => {}) {
    this.clips = clips;
    this.audio = audio;
    this.sample = sample;
    this.clear = clear;
    this.motion = null;
    this.frame = 0;
    this.lastTime = null;
    this.serial = 0;
    this.destroyed = false;
  }
  suspend() {
    this.lastTime = null;
  }
  update(floor: any, paused: any = false) {
    if (this.destroyed) return;
    this.visual?.setEnabled(!!lampMotionForFloor(floor));
    if (paused || !this.audio.active) {
      this.lastTime = null;
      return;
    }
    const now = this.audio.time,
      key = lampMotionForFloor(floor),
      changed = key !== this.motion;
    let from = this.frame,
      dt = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;
    if (changed) {
      this.audio.releaseEffects('lamp:');
      this.motion = key;
      this.frame = 0;
      from = -0.001;
      dt = 0;
    }
    if (!key) return;
    const clip = this.clips.get(key);
    if (!clip) throw Error('Original motion is not ready: ' + key);
    const to = this.frame + dt * clip.fps;
    const cues = [];
    for (const e of clip.events) {
      const first = Math.max(0, Math.ceil((from - e.frame) / clip.frames)),
        last = clip.loop ? Math.floor((to - e.frame) / clip.frames) : 0;
      for (let k = first; k <= last; k++) {
        const at = e.frame + k * clip.frames;
        if (at > from && at <= to) cues.push({ e, at });
      }
    }
    cues.sort((a: any, b: any) => a.at - b.at);
    for (const { e } of cues)
      this.audio.effect(
        'lamp:' + this.serial++,
        { event: e.event, stopPlaying: true, fade: 0, curve: 4 },
        e.position,
        { transient: true, sends: e.sends },
      );
    this.frame = to;
    this.sample(clip, clip.loop ? to % clip.frames : Math.min(to, clip.frames), dt);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.audio.releaseEffects('lamp:');
    this.clear();
    this.lastTime = null;
  }
}

// ShGimmick is not a static scene placement: append its native skinned mesh once.
export function appendGimmickMesh(
  w: any,
  scene: any,
  bytes: Uint8Array,
  path: string,
  world: Float32Array,
  skinHost = w,
  gimmick = false,
) {
  const mesh = withEntry(w, bytes, path, (p: any, n: any) => {
    try {
      if (w._decode_fmdl(p, n)) throw Error('Invalid lamp model');
      const count = w._vertex_count();
      return {
        vertices: w.HEAPF32.slice(w._vertex_ptr() / 4, w._vertex_ptr() / 4 + count * 6),
        tangents: w.HEAPF32.slice(w._tangent_ptr() / 4, w._tangent_ptr() / 4 + count * 4),
        uvs: w.HEAPF32.slice(w._uv_ptr() / 4, w._uv_ptr() / 4 + count * 2),
        indices: w.HEAPU32.slice(w._index_ptr() / 4, w._index_ptr() / 4 + w._index_count()),
        groups: readMaterials(bytes),
        skin: readSkin(bytes, count),
        count,
      };
    } finally {
      w._release_geometry();
    }
  });
  const first = scene.vertices.length / 6,
    indexFirst = scene.indices.length;
  const append = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  scene.vertices = append(scene.vertices, mesh.vertices);
  scene.tangents = append(scene.tangents, mesh.tangents);
  scene.uvs = append(scene.uvs, mesh.uvs);
  const indices = new Uint32Array(indexFirst + mesh.indices.length);
  indices.set(scene.indices);
  indices.set(
    mesh.indices.map((i: number) => i + first),
    indexFirst,
  );
  scene.indices = indices;
  const actor = { lamp: !gimmick, gimmick };
  let renderedGroups = scene.groups;
  const groups = mesh.groups.map((g: any, i: number) => ({
    ...g,
    first: g.first + indexFirst,
    demoActor: actor,
    visible: true,
    castsShadow: (g.flags & 0x140) === 0 && ((g.flags & 0x10) === 0 || (g.flags & 0xf) === 0),
    lampVariant: mesh.skin.chains[i]?.find((name: string) =>
      ['MESH_off', 'MESH_on_ST', 'MESH_on_red_ST'].includes(name),
    ),
    lampHidden: mesh.skin.chains[i]?.some((name: string) =>
      ['MESH_off', 'MESH_on_red_ST'].includes(name),
    ),
  }));
  scene.groups.push(...groups);
  const weights = new Float32Array(mesh.skin.packed),
    joints = new Uint32Array(mesh.skin.packed);
  const blended = new Float32Array(16);
  const visual = {
    first,
    count: mesh.count,
    dirty: false,
    bindGroups(value: any) {
      renderedGroups = value;
    },
    setEnabled(enabled: boolean) {
      for (const g of renderedGroups)
        if (g.demoActor === actor)
          g.visible =
            enabled &&
            (!g.lampVariant ||
              g.lampVariant === (w._lamp_stage_light() ? 'MESH_on_ST' : 'MESH_off'));
    },
    sample() {
      if (skinHost._lamp_bone_count() <= mesh.skin.maxJoint) throw Error('Incomplete lamp palette');
      const ptr = skinHost._lamp_skin() / 4;
      const palette = w.HEAPF32.slice(ptr, ptr + skinHost._lamp_bone_count() * 16);
      for (let i = 0; i < palette.length; i += 16)
        palette.set(multiply(world, palette.subarray(i, i + 16)), i);
      for (let i = 0; i < mesh.count; i++) {
        blended.fill(0);
        for (let k = 0; k < 4; k++)
          for (let j = 0; j < 16; j++)
            blended[j] += weights[i * 8 + k] * palette[joints[i * 8 + k + 4] * 16 + j];
        const m = blended,
          vi = i * 6,
          ti = i * 4,
          out = (first + i) * 6,
          to = (first + i) * 4;
        for (let k = 0; k < 3; k++) {
          scene.vertices[out + k] =
            m[k] * mesh.vertices[vi] +
            m[k + 4] * mesh.vertices[vi + 1] +
            m[k + 8] * mesh.vertices[vi + 2] +
            m[k + 12];
          scene.vertices[out + k + 3] =
            m[k] * mesh.vertices[vi + 3] +
            m[k + 4] * mesh.vertices[vi + 4] +
            m[k + 8] * mesh.vertices[vi + 5];
          scene.tangents[to + k] =
            m[k] * mesh.tangents[ti] +
            m[k + 4] * mesh.tangents[ti + 1] +
            m[k + 8] * mesh.tangents[ti + 2];
        }
        scene.tangents[to + 3] = mesh.tangents[ti + 3];
      }
      visual.dirty = true;
    },
  };
  visual.setEnabled(true);
  return visual;
}
