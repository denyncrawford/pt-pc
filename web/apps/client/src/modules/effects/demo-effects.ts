import { withEntry, withString } from '../gameplay/runtime';
import { multiply } from '../renderer/lighting';
interface Manifest {
  shapes: { kind: number; material: number; blend: number; texture: string; reflection: string }[];
  unsupported: string[];
  flares: string[];
}
// One native simulation per scene. Sequence instance names own their particles.
export function createDemoEffects(w: any) {
  w._vfx_reset();
  const manifests = new Map<string, Manifest>(),
    instances = new Map<string, number>();
  let nextId = 1;
  const pointer = w._malloc(31 * 4);
  return {
    manifests,
    prepare(path: string, bytes: Uint8Array) {
      if (manifests.has(path)) return;
      withEntry(w, bytes, path, (p: number, n: number) =>
        withString(w, path, (k: number) => w._vfx_file(k, p, n)),
      );
      const manifest: Manifest = withString(w, path, (k: number) =>
        JSON.parse(w.UTF8ToString(w._vfx_manifest(k))),
      );
      if (
        manifest.unsupported.length ||
        manifest.flares.length ||
        manifest.shapes.some((s) => s.kind !== 2 || s.material !== 3 || s.blend !== 0)
      )
        throw Error('Demo VFX material not yet implemented: ' + path);
      manifests.set(path, manifest);
    },
    spawn(key: string, path: string, origin: Float32Array, position: Float32Array) {
      if (!manifests.has(path)) throw Error('Effect is not ready: ' + path);
      const local = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1]);
      const matrix = multiply(origin, local);
      const previous = instances.get(key);
      if (previous !== undefined) w._vfx_remove(previous);
      const id = nextId++;
      instances.set(key, id);
      w.HEAPF32.set(matrix, pointer / 4);
      if (!withString(w, path, (k: number) => w._vfx_spawn(id, k, pointer, id)))
        throw Error('Could not create ' + path);
    },
    release(prefix: string) {
      for (const [key, id] of instances)
        if (key.startsWith(prefix)) {
          w._vfx_remove(id);
          instances.delete(key);
        }
    },
    step(dt: number) {
      if (!w._vfx_instances()) return;
      // Simulation doesn't depend on viewport; draw rebuilds billboard geometry with the actual camera.
      w.HEAPF32.set(
        [
          0,
          0,
          0,
          0,
          0,
          -1,
          0,
          1,
          0,
          1,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          16 / 9,
          1,
          0.05,
        ],
        pointer / 4,
      );
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(0.1, remaining);
        w._vfx_tick(step, pointer);
        remaining -= step;
      }
    },
    view(values: Float32Array) {
      w.HEAPF32.set(values, pointer / 4);
      w._vfx_tick(0, pointer);
    },
    destroy() {
      w._free(pointer);
      w._vfx_reset();
      instances.clear();
    },
  };
}
export type DemoEffects = ReturnType<typeof createDemoEffects>;
