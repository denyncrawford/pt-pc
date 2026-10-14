import { selectLights, parseLpsh, mirrorPlane } from '../renderer/lighting';
import { readMaterials } from '../renderer/materials';
import { Psarc, parseFpk, fpkEntry, MAX_ENTRY } from '../../lib/archives';
export function withEntry(wasm: any, bytes: any, name: any, fn: any) {
  if (!bytes.length || bytes.length > MAX_ENTRY) throw Error('Recurso demasiado grande o vacío');
  const p = wasm._malloc(bytes.length),
    encoded = new TextEncoder().encode(name + '\0'),
    n = wasm._malloc(encoded.length);
  try {
    wasm.HEAPU8.set(bytes, p);
    wasm.HEAPU8.set(encoded, n);
    let size = bytes.length;
    if (bytes[0] === 0x1b || bytes[0] === 0x1c) size = wasm._decrypt_entry(p, size, n);
    if (!size) throw Error('No se pudo leer ' + name);
    return fn(p, size);
  } finally {
    wasm._free(p);
    wasm._free(n);
  }
}
export async function hallwayResources(file: any, kind: any = 'hallway') {
  const archive = await new Psarc(file).open(),
    entries = new Map();
  for (const name of archive.names.keys())
    if (name.includes('/' + kind + '/') && /\.fpkd?$/.test(name)) {
      const pkg = parseFpk(await archive.read(name));
      for (const entry of pkg.entries) entries.set(entry.name, () => fpkEntry(pkg, entry.name));
    }
  return entries;
}
export function scenePlacements(wasm: any, entries: any, kind: any = 'hallway'): any[] {
  const name = [...entries.keys()].find((n: any) => n.endsWith('/pt14_' + kind + '.fox2'));
  if (!name) throw Error('La escena hallway FOX2 no está disponible');
  const count = withEntry(wasm, entries.get(name)(), name, (p: any, n: any) =>
    wasm._scene_load(p, n),
  );
  if (!count) throw Error('No se pudo interpretar la escena FOX2');
  return Array.from({ length: count }, (_: any, i: any) => ({
    modelIndex: i,
    nazo: wasm.UTF8ToString(wasm._scene_model_nazo(i)),
    name: wasm.UTF8ToString(wasm._scene_model_name(i)),
    mirror: !!wasm._scene_is_mirror(i),
    model: wasm.UTF8ToString(wasm._scene_model(i)),
    geom: wasm.UTF8ToString(wasm._scene_geom(i)),
    matrix: wasm.HEAPF32.slice(wasm._scene_matrix(i) / 4, wasm._scene_matrix(i) / 4 + 16),
  }));
}
// The scripted scene includes every native StaticModel, including initially hidden
// variants. Visibility is controlled by FOX2 flags and the original stage scripts.
export async function loadHallway(
  wasm: any,
  file: any,
  progress: any = () => {},
  { scripts = false, kind = 'hallway' }: any = {},
) {
  progress('Leyendo escena y colisiones originales…');
  const entries = await hallwayResources(file, kind),
    all = scenePlacements(wasm, entries, kind),
    placements = all.filter((p: any) => /\/shsb_(hous001|bath001|pssg001)\.fmdl$/.test(p.model));
  if (kind === 'hallway' && placements.length !== 3)
    throw Error('Faltan las tres piezas arquitectónicas del pasillo');
  // Closed original entry/exit doors bound this isolated hallway; no loop transitions yet.
  placements.push(...all.filter((p: any) => p.mirror));
  placements.push(...all.filter((p: any) => /\/shsb_hous001_door001\.fmdl$/.test(p.model)));
  if (scripts) {
    for (const [name, read] of entries)
      if (name.endsWith('.lua'))
        withEntry(wasm, read(), name, (p: any, n: any) =>
          withString(wasm, name, (path: any) => {
            if (!wasm._script_load(path, p, n))
              throw Error('Script original incompatible: ' + name);
          }),
        );
    // The browser checkpoint begins after f000's entrance. Run the original entrance setup.
    if (kind === 'hallway')
      for (const name of [
        'pt14_hallway|pt14_hallway_demo|common_demo|condition_Light',
        'pt14_hallway|pt14_hallway_demo|common_demo|condition_Setup_Sound',
        'pt14_hallway|pt14_hallway_trap0000|condition_loadStage',
      ])
        withString(wasm, name, (p: any) => {
          if (wasm._script_exec_condition(p) !== 1) throw Error('No se pudo preparar ' + name);
        });
  }
  if (scripts || kind === 'start') {
    placements.length = 0;
    placements.push(...all);
  } // Preserve native collision/contact order.
  // Include the native door variants so Lua visibility and GeomActive share
  // the same owners. Decorative prop collisions remain separately audited.
  const collisionSupported = (p: any) =>
    kind === 'start' ||
    /\/shsb_(hous001|bath001|pssg001|hous001_door001|hous001_door002|hous001_door004|hous001_door005|hous001_door007)\.fmdl$/.test(
      p.model,
    ) ||
    !!p.nazo;
  const pendingCollisions = placements
    .filter(
      (p: any) =>
        !collisionSupported(p) &&
        entries.has(p.geom) &&
        !/clock|lght|flon|flof|wlon|wlof|lton|ltof|rdon/.test(p.model),
    )
    .map((p: any) => p.name);
  const meshes = [],
    groups = [];
  let vertexCount = 0,
    indexCount = 0;
  wasm._world_clear();
  for (const placement of placements) {
    const { model, geom, matrix: m } = placement;
    progress('Preparando ' + model.split('/').pop());
    if (!entries.has(model)) throw Error('Falta el modelo: ' + model);
    if (geom && !entries.has(geom)) throw Error('Falta la colisión: ' + model);
    withEntry(wasm, entries.get(model)(), model, (p: any, n: any) => {
      try {
        if (wasm._decode_fmdl(p, n)) throw Error('Modelo incompatible: ' + model);
        placement.rawPositions = wasm.HEAPF32.slice(
          wasm._raw_position_ptr() / 4,
          wasm._raw_position_ptr() / 4 + wasm._raw_position_count() * 3,
        );
        const v = wasm.HEAPF32.slice(
          wasm._vertex_ptr() / 4,
          wasm._vertex_ptr() / 4 + wasm._vertex_count() * 6,
        );
        const uv = wasm.HEAPF32.slice(
          wasm._uv_ptr() / 4,
          wasm._uv_ptr() / 4 + wasm._vertex_count() * 2,
        );
        const tangents = wasm.HEAPF32.slice(
          wasm._tangent_ptr() / 4,
          wasm._tangent_ptr() / 4 + wasm._vertex_count() * 4,
        );
        placement.tangentFallback = 0;
        for (let i = 0; i < tangents.length; i += 4)
          if (Math.hypot(...tangents.subarray(i, i + 3)) < 1e-8) placement.tangentFallback++;
        const materialGroups = readMaterials(wasm.HEAPU8.subarray(p, p + n));
        for (const g of materialGroups)
          groups.push({
            ...g,
            modelIndex: placement.modelIndex,
            mirror: placement.mirror && g.material?.shader === 'fox_3dfw_parallax_reflection',
            first: g.first + indexCount,
          });
        const ix = wasm.HEAPU32.slice(
          wasm._index_ptr() / 4,
          wasm._index_ptr() / 4 + wasm._index_count(),
        );
        // Shell placements contain rotation and translation (no nonuniform scale).
        for (let j = 0; j < v.length; j += 6) {
          const [x, y, z, nx, ny, nz] = v.subarray(j, j + 6);
          for (let k = 0; k < 3; k++) {
            v[j + k] = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k];
            v[j + 3 + k] = m[k] * nx + m[4 + k] * ny + m[8 + k] * nz;
          }
        }
        for (let j = 0; j < tangents.length; j += 4) {
          const [x, y, z] = tangents.subarray(j, j + 3);
          for (let k = 0; k < 3; k++) tangents[j + k] = m[k] * x + m[4 + k] * y + m[8 + k] * z;
        }
        for (let j = 0; j < ix.length; j++) ix[j] += vertexCount;
        placement.vertexFirst = vertexCount;
        placement.vertexCount = v.length / 6;
        meshes.push({ v, ix, uv, tangents });
        vertexCount += v.length / 6;
        indexCount += ix.length;
      } finally {
        wasm._release_geometry();
      }
    });
    if (
      !collisionSupported(placement) ||
      placement.mirror ||
      !entries.has(geom) ||
      /clock|lght|flon|flof|wlon|wlof|lton|ltof|rdon/.test(model)
    )
      continue; // Decorative surface: the bathroom shell already supplies its wall collision.
    const encoded = new TextEncoder().encode(placement.name + '\0'),
      np = wasm._malloc(encoded.length);
    let owner;
    try {
      wasm.HEAPU8.set(encoded, np);
      owner = wasm._world_owner_create(np);
    } finally {
      wasm._free(np);
    }
    placement.owner = owner;
    if (!wasm._world_owner_select(owner)) throw Error('Propietario de colisión inválido');
    const mp = wasm._malloc(64);
    try {
      wasm.HEAPF32.set(m, mp / 4);
      const count = withEntry(wasm, entries.get(geom)(), geom, (p: any, n: any) =>
        wasm._world_add_geom(p, n, mp),
      );
      const rp = wasm._malloc(placement.rawPositions.byteLength);
      try {
        wasm.HEAPF32.set(placement.rawPositions, rp / 4);
        withEntry(wasm, entries.get(geom)(), geom, (p: any, n: any) => {
          if (wasm._world_surface_geom(p, n, mp, rp, placement.rawPositions.length / 3) < 0)
            throw Error('Superficies acústicas inválidas');
        });
      } finally {
        wasm._free(rp);
      }
      if (count < 0) throw Error('Colisión incompatible: ' + geom);
      if (count === 0)
        delete placement.owner; // Original decorative GEOM files can contain only acoustic surfaces.
      else if (scripts)
        wasm._world_owner_active(owner, wasm._scene_model_visible(placement.modelIndex) ? 1 : 0);
    } finally {
      wasm._free(mp);
    }
  }
  const collisionCount = wasm._world_build();
  const tangents = new Float32Array(vertexCount * 4),
    uvs = new Float32Array(vertexCount * 2),
    vertices = new Float32Array(vertexCount * 6),
    indices = new Uint32Array(indexCount);
  let v = 0,
    i = 0;
  for (const mesh of meshes) {
    vertices.set(mesh.v, v);
    tangents.set(mesh.tangents, (v / 6) * 4);
    uvs.set(mesh.uv, v / 3);
    indices.set(mesh.ix, i);
    v += mesh.v.length;
    i += mesh.ix.length;
  }
  if (kind === 'start') withString(wasm, 'f000', (p: any) => wasm._script_set_floor(p));
  // Spawn just inside the original start-door connector, facing into the corridor.
  let spawn;
  for (let i = 0; i < wasm._locator_count(); i++)
    if (
      wasm
        .UTF8ToString(wasm._locator_name(i))
        .endsWith(kind === 'start' ? '|PlayerLocator' : '|Connector_startDoor')
    ) {
      const p = wasm._locator_matrix(i) / 4,
        m = wasm.HEAPF32.slice(p, p + 16);
      const x = m[12] - (kind === 'start' ? 0 : m[8]),
        z = m[14] - (kind === 'start' ? 0 : m[10]),
        floor = wasm._world_floor(x, m[13] + 0.5, z);
      if (floor < m[13] - 1 || floor > m[13] + 0.5)
        throw Error('No hay suelo bajo la entrada original');
      spawn = { position: [x, floor + 0.05, z], yaw: Math.atan2(-m[8], m[10]) };
      break;
    }
  if (!spawn) throw Error('Falta el punto de entrada original');
  const probes = [],
    files = new Map();
  for (let i = 0; i < wasm._probe_count(); i++) {
    const name = wasm.UTF8ToString(wasm._probe_name(i));
    if (scripts ? !wasm._probe_enabled(i) : !name.includes('_light_ID10|')) continue;
    const ptr = wasm._probe_data(i);
    if (!ptr) throw Error('Volumen de sonda inválido: ' + name);
    const meta = wasm.HEAPF32.slice(ptr / 4, ptr / 4 + 24),
      path = wasm.UTF8ToString(wasm._probe_path(i));
    if (!files.has(path)) {
      if (!entries.has(path)) throw Error('Falta iluminación original: ' + path);
      files.set(
        path,
        withEntry(wasm, entries.get(path)(), path, (p: any, n: any) =>
          parseLpsh(wasm.HEAPU8.subarray(p, p + n)),
        ),
      );
    }
    const sh = meta[23] ? new Float32Array(36) : files.get(path).get(name.split('|').at(-1));
    if (!sh) throw Error('Faltan coeficientes de sonda: ' + name);
    const data = new Float32Array(60);
    data.set(meta.subarray(0, 16));
    data.set([...meta.slice(16, 19), 1], 16);
    data.set(meta.slice(19, 22), 20);
    data.set(sh, 24);
    if (!data.every(Number.isFinite)) throw Error('Sonda no finita');
    probes.push({ name, priority: meta[22], dark: !!meta[23], data });
  }
  if (!probes.length || probes.length > 256) throw Error('Cantidad de sondas incompatible');
  probes.sort((a: any, b: any) => b.priority - a.priority);
  return {
    entries: scripts ? entries : undefined,
    placements,
    pendingCollisions,
    vertices,
    indices,
    uvs,
    tangents,
    groups,
    collisionCount,
    spawn,
    lights: selectLights(wasm, scripts ? null : 'ID10'),
    probes,
    mirrorPlane: kind === 'start' ? null : mirrorPlane(vertices, indices, groups),
  };
}
export const PHYSICS_STEP = 1 / 300;
export function stepPlayer(wasm: any, dx: any, dz: any, dt: any = PHYSICS_STEP) {
  const p = wasm._player_step(dx, dz, dt) / 4;
  return wasm.HEAPF32.slice(p, p + 4);
}

export function withString(wasm: any, value: any, fn: any) {
  const b = new TextEncoder().encode(value + '\0'),
    p = wasm._malloc(b.length);
  try {
    wasm.HEAPU8.set(b, p);
    return fn(p);
  } finally {
    wasm._free(p);
  }
}

export async function prepareLocomotion(w: any, file: any, progress: any = () => {}) {
  progress('Preparando animaciones y rig originales del jugador…');
  const a = await new Psarc(file).open(),
    resources = new Map();
  for (const name of ['player2_common_motion', 'plparts_normal']) {
    const pkg = parseFpk(
      await a.read('as/sh/level_asset/chara/player/game_object/' + name + '.fpk'),
    );
    for (const e of pkg.entries)
      if (
        e.name.endsWith('/ShPlayer_layers.mtar') ||
        e.name.endsWith('/human_finger.frig') ||
        e.name.endsWith('/plr0_main0_def.fmdl')
      )
        resources.set(e.name, fpkEntry(pkg, e.name));
  }
  const paths = [
    '/Assets/sh/rig/frig/human_finger.frig',
    '/Assets/sh/chara/plr/Scenes/plr0_main0_def.fmdl',
    '/Assets/sh/motion/mtar/player/ShPlayer_layers.mtar',
  ];
  for (const p of paths) if (!resources.has(p)) throw Error('Falta animación original: ' + p);
  const [rig, model, motion] = paths;
  const ok = withEntry(w, resources.get(rig), rig, (r: any, rn: any) =>
    withEntry(w, resources.get(model), model, (s: any, sn: any) =>
      withEntry(w, resources.get(motion), motion, (m: any, mn: any) =>
        w._locomotion_load(r, rn, s, sn, m, mn),
      ),
    ),
  );
  if (!ok) throw Error('Rig o animaciones originales del jugador incompatibles');
  let pose = new Float32Array(12);
  pose[5] = 1.6;
  const handoff = new CameraHandoff();
  return {
    get pose() {
      return pose;
    },
    handCameraBack(camera: any, feet: any) {
      handoff.capture(camera, feet, pose[7]);
    },
    camera(feet: any) {
      const by = pose[7],
        eye = [
          feet[0] + Math.cos(by) * pose[4] + Math.sin(by) * pose[6],
          feet[1] + pose[5],
          feet[2] - Math.sin(by) * pose[4] + Math.cos(by) * pose[6],
        ];
      return handoff.apply(eye, feet, by);
    },
    reset(yaw: any) {
      w._locomotion_reset(Math.atan2(Math.sin(yaw), -Math.cos(yaw)));
      pose = new Float32Array(12);
      pose[5] = 1.6;
      pose[7] = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
      handoff.reset();
    },
    step(x: any, z: any, yaw: any, dt: any) {
      const p = w._locomotion_step(x, z, Math.atan2(Math.sin(yaw), -Math.cos(yaw)), dt) / 4;
      pose = w.HEAPF32.slice(p, p + 12);
      if (!pose.every(Number.isFinite)) throw Error('Pose del jugador no finita');
      handoff.advance(dt, Math.min(1, Math.hypot(x, z)));
      return pose;
    },
  };
}

// Only a real pointer lock can provide unbounded relative mouse movement.
export function createPointerCapture({
  canvas,
  doc = document,
  onCapture = () => {},
  onError = () => {},
  onRelease = () => {},
  defer = (fn: any) => setTimeout(fn, 0),
}: any) {
  let pending = false,
    held = false,
    generation = 0;
  const locked = () => doc.pointerLockElement === canvas;
  function failed(error: any) {
    if (!pending) return;
    pending = false;
    canvas.style.cursor = '';
    onError(error);
  }
  function changed() {
    if (locked()) {
      if (!pending && !held) {
        doc.exitPointerLock?.();
        return;
      }
      pending = false;
      held = true;
      canvas.style.cursor = 'none';
      onCapture();
    } else if (held) {
      held = false;
      canvas.style.cursor = '';
      // Focus loss releases the browser lock too; it is not an Escape/menu request.
      defer(() => {
        if (!locked() && doc.hasFocus() && !doc.hidden) onRelease();
      });
    }
  }
  doc.addEventListener('pointerlockchange', changed);
  doc.addEventListener('pointerlockerror', failed);
  return {
    locked,
    request() {
      if (locked()) {
        onCapture();
        return;
      }
      if (pending) return;
      pending = true;
      const ticket = ++generation;
      canvas.focus();
      try {
        if (typeof canvas.requestPointerLock !== 'function')
          throw new Error('Pointer Lock no disponible');
        const result = canvas.requestPointerLock();
        // Older browsers report success/failure exclusively through document events.
        result?.catch((error: any) => {
          if (ticket === generation) failed(error);
        });
      } catch (error) {
        failed(error);
      }
    },
    release() {
      generation++;
      pending = false;
      held = false;
      canvas.style.cursor = '';
      if (locked()) doc.exitPointerLock?.();
    },
    dispose() {
      this.release();
      doc.removeEventListener('pointerlockchange', changed);
      doc.removeEventListener('pointerlockerror', failed);
    },
  };
}

// Player::HandCameraBack / UpdateEye: body-local offset, released by movement.
export class CameraHandoff {
  declare weight: any;
  declare local: any;

  constructor() {
    this.reset();
  }
  reset() {
    this.weight = 0;
    this.local = [0, 0, 0];
  }
  capture(eye: any, feet: any, yaw: any) {
    const d = eye.map((v: any, i: any) => v - feet[i]),
      c = Math.cos(yaw),
      s = Math.sin(yaw);
    this.local = [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
    this.weight = 1;
  }
  advance(dt: any, magnitude: any) {
    this.weight = Math.max(0, this.weight - Math.max(0, dt) * Math.max(0, Math.min(1, magnitude)));
  }
  apply(eye: any, feet: any, yaw: any) {
    if (!this.weight) return eye;
    const c = Math.cos(yaw),
      s = Math.sin(yaw),
      p = [
        feet[0] + c * this.local[0] + s * this.local[2],
        feet[1] + this.local[1],
        feet[2] - s * this.local[0] + c * this.local[2],
      ];
    return eye.map((v: any, i: any) => p[i] * this.weight + v * (1 - this.weight));
  }
}

// Player::UpdateZoom, normal standing look. Puzzle actions request the 2x mode
// separately; zoom alone must not complete an unimplemented interaction.
export class PlayerZoom {
  declare value: any;
  declare velocity: any;
  declare active: any;

  constructor() {
    this.reset();
  }
  reset() {
    this.value = 1;
    this.velocity = 1;
    this.active = false;
  }
  update(dt: any, want: any) {
    if (!(dt > 0)) return this.value;
    const speed = 1.85;
    if (want) {
      this.active = true;
      this.velocity = Math.max(0.5, this.velocity - dt);
      this.value += dt * speed * this.velocity;
      if (this.value >= 1.35) {
        const previous = this.value - 2 * dt * speed * this.velocity;
        this.value = Math.max(1.35, previous);
      }
    } else if (this.active) {
      this.velocity = Math.min(1, this.velocity + dt);
      this.value -= dt * speed * this.velocity * 3;
      if (this.value <= 1) {
        this.value = 1;
        this.active = false;
      }
    }
    return this.value;
  }
  fov() {
    return 2 * Math.atan(6.75 / (13 * this.value));
  }
}
