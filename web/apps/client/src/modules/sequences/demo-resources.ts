import { Psarc, parseFpk, fpkEntry } from '../../lib/archives';
import { withEntry, withString } from '../gameplay/runtime';
// Demo-local fileParams take precedence, matching DemoSystem::FilePath.
export async function loadDemoResources(w: any, file: any) {
  const archive = await new Psarc(file).open(),
    entries = new Map<any, any>();
  for (const name of ['as/sh/level/common/resident.fpk', 'as/sh/level/common/resident.fpkd']) {
    const pkg = parseFpk(await archive.read(name));
    for (const e of pkg.entries) entries.set(e.name, () => fpkEntry(pkg, e.name));
  }
  const read = (path: any) => {
    const fn = entries.get(path);
    if (!fn) throw Error('Missing sequence dependency: ' + path);
    return fn();
  };
  const path = '/Assets/sh/demo/fox_project/promotion/pt_2014/resident_demo.fox2';
  const parse = (path: any, method: any) =>
    withEntry(w, read(path), path, (p: any, n: any) => {
      const value = w[method](p, n);
      if (!value) throw Error('Invalid original resource: ' + path);
      return JSON.parse(w.UTF8ToString(value));
    });
  const metadata = new Map<any, any>(parse(path, '_demo_assets_json').map((d: any) => [d.id, d]));
  async function resolvePlayerModel() {
    const packagePath = 'as/sh/level_asset/chara/player/game_object/plparts_normal.fpk';
    for (const path of [packagePath, packagePath + 'd']) {
      const pkg = parseFpk(await archive.read(path));
      for (const e of pkg.entries) entries.set(e.name, () => fpkEntry(pkg, e.name));
    }
    const partsPath = '/Assets/sh/parts/chara/plr/plr0_main0_def_v00.parts';
    const parts = parse(partsPath, '_model_parts_json') as { modelFile: string; hidden: string[] };
    if (!parts.modelFile || !entries.has(parts.modelFile))
      throw Error('Player model missing from its parts');
    return parts;
  }
  const code = (name: any) =>
    withString(w, name, (p: any) => BigInt.asUintN(64, w._demo_name_code(p)).toString());
  const names = new Map<any, any>([...entries.keys()].map((path: any) => [code(path), path]));
  const effects = new Map<any, any>();
  return {
    entries,
    read,
    metadata,
    resolvePlayerModel,
    code,
    effect(demo: any, fileCode: any) {
      const meta = metadata.get(demo);
      if (!meta) throw Error('Missing DemoData: ' + demo);
      const path =
        Object.entries<any>(meta.fileParams).find(
          ([key]: any) => code(key) === fileCode.toString(),
        )?.[1] || names.get(fileCode.toString());
      if (!path) throw Error(`${demo}: unresolved effect ${fileCode.toString(16)}`);
      if (!effects.has(path)) effects.set(path, { path, ...parse(path, '_effect_nodes_json') });
      return effects.get(path);
    },
  };
}
