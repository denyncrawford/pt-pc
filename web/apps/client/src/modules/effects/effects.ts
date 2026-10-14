import { withEntry, withString } from '../gameplay/runtime';
import { loadDemoResources } from '../sequences/demo-resources';
// Native simulation preparation; the renderer must bind every declared material dependency.
export async function prepareEffects(w: any, scene: any, file: any) {
  const resources = await loadDemoResources(w, file),
    entries = new Map<any, () => Uint8Array>([...resources.entries, ...scene.entries]);
  const paths = [
    ...new Set(
      Array.from({ length: w._fx_locator_count() }, (_: any, i: any) =>
        w.UTF8ToString(w._fx_locator_path(i)),
      ),
    ),
  ];
  w._vfx_reset();
  const manifests = new Map(),
    dependencies = new Set();
  const load = (path: any) => {
    const read = entries.get(path);
    if (!read) throw Error('Falta recurso VFX: ' + path);
    withEntry(w, read(), path, (p: any, n: any) => {
      if (!withString(w, path, (k: any) => w._vfx_file(k, p, n)))
        throw Error('Recurso VFX inválido: ' + path);
    });
  };
  try {
    for (const path of paths) {
      load(path);
      const manifest = withString(w, path, (k: any) => {
        const p = w._vfx_manifest(k);
        if (!p) throw Error('No se pudo compilar VFX: ' + path);
        return JSON.parse(w.UTF8ToString(p));
      });
      if (manifest.unsupported.length)
        throw Error('Nodos VFX pendientes: ' + path + ': ' + manifest.unsupported.join(', '));
      if (!manifest.shapes.length && !manifest.flares.length) continue;
      manifests.set(path, manifest);
      for (const name of manifest.flares)
        load('/Assets/sh/effect/vfx_data/lensflare/' + name + '.vfxlf');
      for (const shape of manifest.shapes) {
        for (const field of ['texture', 'normal', 'reflection', 'rain'])
          if (shape[field]) dependencies.add(shape[field]);
        if (shape.kind !== 4) continue;
        const model = [...entries.keys()].find(
          (path: any) => path.endsWith('.fmdl') && resources.code(path) === shape.model,
        );
        if (!model) throw Error('Falta modelo VFX: ' + shape.model);
        withEntry(w, entries.get(model)(), model, (p: any, n: any) => {
          try {
            if (w._decode_fmdl(p, n)) throw Error('Modelo VFX inválido: ' + model);
            if (
              !withString(w, shape.model, (k: any) =>
                w._vfx_model(
                  k,
                  w._vertex_ptr(),
                  w._uv_ptr(),
                  w._index_ptr(),
                  w._vertex_count(),
                  w._index_count(),
                ),
              )
            )
              throw Error('Geometría VFX inválida');
          } finally {
            w._release_geometry();
          }
        });
      }
    }
    return {
      manifests,
      dependencies,
      entries,
      destroy() {
        w._vfx_reset();
      },
    };
  } catch (error) {
    w._vfx_reset();
    throw error;
  }
}
