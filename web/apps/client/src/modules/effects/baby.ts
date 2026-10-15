import { withEntry, withString } from '../gameplay/runtime';
import { loadDemoResources } from '../sequences/demo-resources';
import { transformPoint } from '../gameplay/first-loop';
import { appendGimmickMesh } from './lamp';

// Native Baby/Baby3 GANI tracks use their own palette, independent of CeilLamp.
export async function prepareBaby(w: any, scene: any, file: any) {
  const ptr = w._baby_locator();
  if (!ptr) throw Error('Missing original baby locator');
  const world = w.HEAPF32.slice(ptr / 4, ptr / 4 + 16);
  const resources = await loadDemoResources(w, file);
  const mtar = '/Assets/sh/motion/mtar/gimmick/ShGimmick_layers.mtar';
  const model = '/Assets/sh/chara/bab/Scenes/bab0_main0_def.fmdl';
  w._baby_clear();
  withEntry(w, resources.read(mtar), mtar, (p: number, n: number) => {
    if (!w._baby_archive(p, n)) throw Error('Invalid baby motion archive');
  });
  withEntry(w, resources.read(model), model, (p: number, n: number) => {
    if (!w._baby_model(p, n)) throw Error('Invalid baby skeleton');
  });
  const clips = new Map<
    string,
    {
      path: string;
      frames: number;
      fps: number;
      loop: boolean;
      events: { frame: number; args: number[]; bone: string }[];
    }
  >();
  for (const [key, suffix] of [
    ['Baby', '020'],
    ['Baby3', '030'],
  ]) {
    const path = `/Assets/sh/motion/SI_game/fani/bodies/bab0/bab0/bab0_m00_${suffix}.gani`;
    const clip = withEntry(w, resources.read(mtar), mtar, (p: number, n: number) =>
      withString(w, path, (k: number) =>
        JSON.parse(w.UTF8ToString(w._gimmick_audio_json(p, n, k))),
      ),
    );
    if (!withString(w, path, (p: number) => w._baby_motion(p)))
      throw Error('Unsupported baby motion');
    if (clip.events.some((e: { args: number[] }) => e.args.length !== 2 || e.args[0] !== 6))
      throw Error('Unsupported baby event');
    clips.set(key, { ...clip, path });
  }
  const visual = appendGimmickMesh(
    w,
    scene,
    resources.read(model),
    model,
    world,
    {
      _lamp_bone_count: () => w._baby_bone_count(),
      _lamp_skin: () => w._baby_skin(),
    },
    true,
  );
  let key = 'Baby',
    frame = 0,
    returnToIdle = true;
  return {
    visual,
    get motion() {
      return key;
    },
    play(next: string, idle: boolean) {
      if (!clips.has(next)) throw Error('Baby motion not yet implemented: ' + next);
      key = next;
      frame = 0;
      returnToIdle = idle;
    },
    update(dt: number, audio?: { effect: (...args: unknown[]) => void }) {
      let clip = clips.get(key)!;
      const previous = frame;
      frame += Math.max(0, dt) * clip.fps;
      for (const event of clip.events)
        if (event.frame > previous && event.frame <= frame) {
          if (!audio) throw Error('Missing baby motion audio');
          withString(w, clip.path, (p: number) => w._baby_motion(p));
          w._baby_sample(event.frame);
          const bone = withString(w, event.bone, (p: number) => w._baby_bone(p));
          if (!bone) throw Error('Missing baby sound bone');
          const position = transformPoint(world, w.HEAPF32.slice(bone / 4 + 12, bone / 4 + 15));
          audio.effect(
            'baby:' + key + ':' + event.frame,
            { event: event.args[1] >>> 0, stopPlaying: true, fade: 0, curve: 4 },
            position,
            { transient: true },
          );
        }
      if (!clip.loop && frame >= clip.frames && returnToIdle) {
        key = 'Baby';
        frame = 0;
        clip = clips.get(key)!;
      }
      withString(w, clip.path, (p: number) => w._baby_motion(p));
      if (!w._baby_sample(clip.loop ? frame % clip.frames : Math.min(frame, clip.frames)))
        throw Error('Invalid baby pose');
      visual.sample();
    },
    destroy() {
      w._baby_clear();
    },
  };
}
