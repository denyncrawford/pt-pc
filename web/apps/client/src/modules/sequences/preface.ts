// The original preface is a UI demo, not a camera demo. Its clock must finish
// before gc_p00_022 starts; all artwork and event timings come from the user's copy.
import { Psarc, parseFpk, fpkEntry } from '../../lib/archives';
import { parseNativeUi, sampleTrack } from '../menu/native-ui';
import { Qar, parsePftxs, loadFtex } from '../renderer/materials';
import { loadDemoResources } from './demo-resources';
import { SequenceClock, SequencePlayer, SEQUENCE_FPS } from './sequence-player';

// Opening checkpoints restart the authored wake-up; they must include its titles.
// Hallway checkpoints resume the current loop without replaying the opening.
export function shouldPlayPreface(kind: string) {
  return kind === 'start';
}

interface Decoder {
  _sequence_event_string(index: number, key: number): bigint;
}
interface Action {
  kind: number;
  animation: string;
  speed: number;
  loop: boolean;
  layout: string;
  target: string;
  visible: boolean;
}
interface Graph {
  layouts: string[];
  start: Action[];
  events: { name: string; actions: Action[] }[];
}
interface Track {
  unit: number;
  frames: number[];
  values: number[][];
}
interface Animation {
  frames: number;
  nodes: { hash: number; tracks: Track[] }[];
}
interface Node {
  hash: number;
  type: number;
  parent: number;
  color: number[];
  translate: number[];
  scale: number[];
  size: number[];
  positions: number[][];
  textures: number[];
}
interface Layout {
  animations: { name: string; main: string; shader: string; speed: number }[];
  models: string[];
}
interface Model {
  nodes: Node[];
  textures: string[];
}
interface Caption {
  start: number;
  end: number;
  text: string;
}
export interface PrefaceFrame {
  finished: boolean;
  pictures: {
    texture: string;
    opacity: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  caption: string;
}
interface Event {
  index: number;
  frame: number;
  functor: bigint;
  type: bigint;
}

export function readPrefaceCaptions(bytes: Uint8Array): Map<number, Caption[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = new Map<number, Caption[]>();
  if (bytes.length < 4) throw Error('Incomplete opening table');
  const count = view.getUint16(2, true);
  if (4 + count * 8 > bytes.length) throw Error('Incomplete opening index');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    const key = view.getUint32(4 + i * 8, true),
      offset = view.getUint32(8 + i * 8, true);
    if (offset + 12 > bytes.length) throw Error('Incomplete opening message');
    const lines = bytes[offset + 2]!,
      length = view.getUint16(offset + 4, true);
    const start = offset + 12 + lines * 4;
    if (start + length > bytes.length) throw Error('Incomplete opening text');
    const raw = bytes.subarray(start, start + length);
    let text: string;
    try {
      text = utf8.decode(raw);
    } catch {
      text = new TextDecoder('windows-1252').decode(raw);
    }
    const pieces = text.replace(/\0+$/, '').split('$');
    table.set(
      key,
      Array.from({ length: lines }, (_, line) => ({
        start: view.getUint16(offset + 12 + line * 4, true) / 100,
        end: view.getUint16(offset + 14 + line * 4, true) / 100,
        text: (pieces[line] ?? '').replace(/\r/g, '').replace(/^[\n ]+|\n+$/g, ''),
      })),
    );
  }
  return table;
}

export async function loadPreface(w: Decoder, file: Blob, textureFile: Blob, language = 'Eng') {
  const resources = await loadDemoResources(w, file);
  const meta = resources.metadata.get('gc_p02_500');
  if (!meta) throw Error('Missing opening sequence');
  const graph: Graph = parseNativeUi(
    w,
    resources.read(meta.fileParams.opui),
    meta.fileParams.opui,
    6,
  );
  const archive = await new Psarc(file).open();
  const entries = new Map<string, Uint8Array>(),
    packed = new Map<string, Uint8Array>();
  for (const path of archive.names.keys()) {
    if (/\/ui\/ui_default_data\.fpkd?$/.test(path)) {
      const pkg = parseFpk(await archive.read(path));
      for (const entry of pkg.entries) entries.set(entry.name, fpkEntry(pkg, entry.name));
    }
    if (/\/ui\/ui_default_data\.pftxs$/.test(path))
      for (const [name, bytes] of parsePftxs(await archive.read(path))) packed.set(name, bytes);
  }
  const read = <T>(path: string, kind: number): T => {
    const bytes = entries.get(path);
    if (!bytes) throw Error('Missing opening resource: ' + path);
    return parseNativeUi(w, bytes, path, kind) as T;
  };
  const layouts = graph.layouts.map((path) => ({
    name: resources.code(
      path
        .split('/')
        .pop()!
        .replace(/\.uilb$/, ''),
    ) as string,
    data: read<Layout>(path, 2),
    visible: true,
    animation: null as { data: Animation; start: number; speed: number; loop: boolean } | null,
  }));
  const models = new Map<string, Model>(),
    animations = new Map<string, Animation>();
  const textures = new Map<string, { width: number; height: number; rgba: Uint8Array }>();
  const qar = await new Qar(textureFile, w).open();
  const source = { read: (path: string) => packed.get(path) ?? qar.read(path) };
  for (const layout of layouts) {
    for (const path of layout.data.models) {
      const model = read<Model>(path, 0);
      models.set(path, model);
      for (const texture of model.textures)
        if (!textures.has(texture))
          textures.set(
            texture,
            await loadFtex(source, texture.replace(/\.ftex$/, ''), Infinity, { strict: true }),
          );
    }
    for (const animation of layout.data.animations) {
      if (animation.shader) throw Error('Unsupported opening shader: ' + animation.shader);
      animations.set(animation.name, read<Animation>(animation.main, 1));
    }
  }
  const subtitlePath = (lang: string) =>
    'as/sh/level/ui/subtitles/EngVoice/' + lang + 'Text/subtitle.fpk';
  const lang = archive.names.has(subtitlePath(language)) ? language : 'Eng';
  const pkg = parseFpk(await archive.read(subtitlePath(lang)));
  const subp = pkg.entries.find((entry: { name: string }) => entry.name.endsWith('.subp'));
  if (!subp) throw Error('Missing opening text');
  const captions = readPrefaceCaptions(fpkEntry(pkg, subp.name));
  const clock = new SequenceClock(),
    player = new SequencePlayer(w, resources.read(meta.demoStreamPath), 'gc_p02_500', clock);
  let caption: { frame: number; lines: Caption[] } | null = null;
  const actions = (list: Action[], frame: number) => {
    for (const action of list) {
      if (action.kind === 0) {
        const layout = layouts.find((l) =>
          l.data.animations.some((a) => a.name === action.animation),
        );
        const data = animations.get(action.animation);
        if (!layout || !data) throw Error('Unknown opening animation');
        const authored = layout.data.animations.find((a) => a.name === action.animation)!;
        layout.animation = {
          data,
          start: frame,
          speed: action.speed * authored.speed,
          loop: action.loop,
        };
      } else {
        const layout = layouts.find((l) => l.name === action.layout);
        // DemoUi::SetVisible ignores layouts absent from the graph. The company
        // event names the model stem instead of the UILB stem; its UIA owns opacity.
        if (!layout) continue;
        if (action.target !== '203000540209048' && action.target !== layout.name)
          throw Error('Unknown opening visibility');
        layout.visible = action.visible;
      }
    }
  };
  player.play();
  return {
    textures,
    length: player.length as number,
    update(dt: number): PrefaceFrame {
      clock.advance(dt);
      player.update((event: Event) => {
        if (event.functor === 0xecec4d259e21n) {
          const name = BigInt.asUintN(
            64,
            w._sequence_event_string(event.index, 0xe5b44417),
          ).toString();
          const entry = graph.events.find((e) => e.name === name);
          if (!entry) throw Error('Unknown opening event');
          actions(entry.actions, event.frame);
        } else if (event.functor === 0x348d6764cd38n) actions(graph.start, event.frame);
        else if (event.functor === 0x4d4d2a467cb6n) {
          const key = Number(BigInt.asUintN(32, w._sequence_event_string(event.index, 0xb03cd7c0)));
          const lines = captions.get(key);
          if (!lines) throw Error('Missing opening message');
          caption = { frame: event.frame, lines };
        } else if (![0n, 0x50543fb8c17an].includes(event.functor))
          throw Error('Opening event not yet implemented: ' + event.functor.toString(16));
      });
      const pictures: PrefaceFrame['pictures'] = [];
      for (const layout of layouts) {
        if (!layout.visible) continue;
        const colors = new Map<number, number[]>();
        if (layout.animation) {
          const { data, start, speed, loop } = layout.animation;
          let frame = (player.frame - start) * speed;
          frame = loop ? frame % data.frames : Math.min(frame, data.frames);
          for (const node of data.nodes)
            for (const track of node.tracks)
              if (track.unit === 0x6318d107) colors.set(node.hash, sampleTrack(track, frame));
              else throw Error('Opening channel not yet implemented: ' + track.unit.toString(16));
        }
        for (const path of layout.data.models) {
          const model = models.get(path)!;
          for (const node of model.nodes) {
            if (node.type !== 2 || node.color.slice(0, 3).every((v) => v === 0)) continue;
            let opacity = 1,
              parent: Node | undefined = node;
            while (parent) {
              opacity *= colors.get(parent.hash)?.[3] ?? parent.color[3]!;
              parent = parent.parent >= 0 ? model.nodes[parent.parent] : undefined;
            }
            const xs = node.positions.map((p) => p[0]! * node.size[0]! * 10);
            const ys = node.positions.map((p) => p[1]! * node.size[1]! * 10);
            pictures.push({
              texture: model.textures[node.textures[0]!]!,
              opacity,
              x: 640 + Math.min(...xs),
              y: 360 - Math.max(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            });
          }
        }
      }
      const activeCaption = caption as { frame: number; lines: Caption[] } | null;
      const elapsed = activeCaption ? (player.frame - activeCaption.frame) / SEQUENCE_FPS : 0;
      return {
        finished: player.state === 'finished',
        pictures,
        caption:
          activeCaption?.lines.find((l) => elapsed >= l.start && elapsed < l.end)?.text ?? '',
      };
    },
    destroy() {
      player.destroy();
    },
  };
}
export type Preface = Awaited<ReturnType<typeof loadPreface>>;
