// First playable slice: original f010 scripts and gc_p00_010, followed by f005.
// Resource bytes stay in the user's archive; adjacent stages share decoded materials.
import { prepareDemoActors } from '../sequences/demo-actors';
import { NativeCameraBlend } from '../sequences/sequence-player';
import { StageCycle } from './stage-cycle';
import { Psarc, parseFpk, fpkEntry } from '../../lib/archives';
import { withEntry, withString } from './runtime';
import { multiply } from '../renderer/lighting';
export const DEMO_FPS = 60000 / 1001;
export const transformPoint = (m: any, p: any, w: any = 1) =>
  [0, 1, 2].map((k: any) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + w * m[12 + k]);
export function inverseRigid(m: any) {
  const out = new Float32Array([
    m[0],
    m[4],
    m[8],
    0,
    m[1],
    m[5],
    m[9],
    0,
    m[2],
    m[6],
    m[10],
    0,
    0,
    0,
    0,
    1,
  ]);
  out.set(transformPoint(out, [-m[12], -m[13], -m[14]], 0), 12);
  return out;
}
export function rotation(q: any) {
  const [x, y, z, w] = q;
  return new Float32Array([
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ]);
}
const basis = ([x, y, z]: any) => [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
// Rotate the already normalized SH polynomial into the adjacent stage's world space.
export function rotateSH(sh: any, m: any) {
  const samples = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [Math.SQRT1_2, Math.SQRT1_2, 0],
      [0, Math.SQRT1_2, Math.SQRT1_2],
      [Math.SQRT1_2, 0, Math.SQRT1_2],
    ],
    inv = inverseRigid(m);
  const rows = samples.map((v: any) => {
    const world = [-v[0], v[2], -v[1]],
      local = transformPoint(inv, world, 0),
      b = basis([-local[0], -local[2], local[1]]);
    return [
      ...basis(v),
      ...[0, 1, 2].map((c: any) => b.reduce((s: any, x: any, i: any) => s + x * sh[i * 4 + c], 0)),
    ];
  });
  for (let i = 0; i < 9; i++) {
    let pivot = i;
    for (let j = i + 1; j < 9; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const d = rows[i][i];
    if (Math.abs(d) < 1e-8) throw Error('Base SH singular');
    for (let k = i; k < 12; k++) rows[i][k] /= d;
    for (let j = 0; j < 9; j++)
      if (j !== i) {
        const f = rows[j][i];
        for (let k = i; k < 12; k++) rows[j][k] -= f * rows[i][k];
      }
  }
  const out = new Float32Array(36);
  rows.forEach((row: any, i: any) => out.set(row.slice(9), i * 4));
  return out;
}
function transformTangents(t: any, m: any) {
  const out = t.slice();
  for (let i = 0; i < t.length; i += 4) out.set(transformPoint(m, t.subarray(i, i + 3), 0), i);
  return out;
}
function transformVertices(vertices: any, m: any) {
  const out = vertices.slice();
  for (let i = 0; i < out.length; i += 6) {
    out.set(transformPoint(m, vertices.subarray(i, i + 3)), i);
    out.set(transformPoint(m, vertices.subarray(i + 3, i + 6), 0), i + 3);
  }
  return out;
}
export async function prepareFirstLoop(w: any, scene: any, file: any) {
  const destination = w.UTF8ToString(w._script_next_floor());
  if (!destination) throw Error('Etapa sin sucesor nativo');
  const cycle = new StageCycle({ floor: 'f010' });
  const a = await new Psarc(file).open(),
    pkg = parseFpk(await a.read('as/sh/level/common/resident.fpk')),
    path = '/Assets/sh/demo/demo_stream/gc_p00_010.fsm';
  const frames = withEntry(w, fpkEntry(pkg, path), path, (p: any, n: any) =>
    w._sequence_load(p, n),
  );
  if (frames !== 128)
    throw Error('Secuencia de salida no compatible: ' + w.UTF8ToString(w._sequence_error()));
  const p = w._stage_next_matrix();
  if (!p) throw Error('Faltan conectores entre etapas');
  const next = w.HEAPF32.slice(p / 4, p / 4 + 16),
    inverse = inverseRigid(next);
  const ambient = await prepareDemoActors(w, scene, file, [
    'gc_p05_010',
    'gc_p04_310',
    'gc_p01_070',
    'gc_p04_340',
    'gc_p01_081',
    'gc_p01_011',
    'gc_p01_020',
    'gc_p03_010',
  ]);
  try {
    const baseTangents = scene.tangents;
    const tangents = new Float32Array(baseTangents.length * 2);
    tangents.set(baseTangents);
    tangents.set(transformTangents(baseTangents, next), baseTangents.length);
    scene.tangents = tangents;
    const baseVertices = scene.vertices,
      baseIndices = scene.indices,
      baseUvs = scene.uvs,
      baseGroups = scene.groups,
      baseLights = scene.lights,
      baseProbes = scene.probes;
    const nv = transformVertices(baseVertices, next),
      vertices = new Float32Array(baseVertices.length * 2);
    vertices.set(baseVertices);
    vertices.set(nv, baseVertices.length);
    const indices = new Uint32Array(baseIndices.length * 2);
    indices.set(baseIndices);
    indices.set(
      baseIndices.map((i: any) => i + baseVertices.length / 6),
      baseIndices.length,
    );
    const uvs = new Float32Array(baseUvs.length * 2);
    uvs.set(baseUvs);
    uvs.set(baseUvs, baseUvs.length);
    scene.vertices = vertices;
    scene.indices = indices;
    scene.uvs = uvs;
    scene.groups = [
      ...baseGroups.map((g: any) => ({ ...g, stage: 0 })),
      ...baseGroups.map((g: any) => ({
        ...g,
        stage: 1,
        mirror: false,
        first: g.first + baseIndices.length,
      })),
    ];
    scene.baseLightingCounts = { lights: baseLights.length, probes: baseProbes.length };
    scene.lights = [
      ...baseLights,
      ...baseLights.map((l: any) => {
        const data = l.data.slice();
        data.set(transformPoint(next, data.subarray(0, 3)), 0);
        data.set(transformPoint(next, data.subarray(8, 11), 0), 8);
        return { name: 'next:' + l.name, data };
      }),
    ];
    scene.probes = [
      ...baseProbes,
      ...baseProbes.map((p: any) => {
        const data = p.data.slice();
        data.set(multiply(data.subarray(0, 16), inverse));
        data.set(rotateSH(data.subarray(24), next), 24);
        return { ...p, name: 'next:' + p.name, data };
      }),
    ];
    const nextOwners = [];
    for (const placement of scene.placements) {
      if (!placement.owner) continue;
      const owner = withString(w, 'next:' + placement.name, (p: any) => w._world_owner_create(p));
      w._world_owner_select(owner);
      const matrix = multiply(next, placement.matrix),
        mp = w._malloc(64);
      try {
        w.HEAPF32.set(matrix, mp / 4);
        const n = withEntry(
          w,
          scene.entries.get(placement.geom)(),
          placement.geom,
          (p: any, n: any) => w._world_add_geom(p, n, mp),
        );
        if (n <= 0) throw Error('La siguiente etapa no tiene colisión');
      } finally {
        w._free(mp);
      }
      nextOwners.push({ placement, owner });
    }
    w._world_build();
    const exit = scene.placements.find((p: any) => p.name.endsWith('_hallway_out')),
      entry = scene.placements.find((p: any) => p.name.endsWith('_hallway_in'));
    if (!exit || !entry) throw Error('Faltan puertas originales');
    const actors = Array.from({ length: w._sequence_actor_count() }, (_: any, i: any) => ({
      i,
      kind: w._sequence_actor_kind(i),
      name: w.UTF8ToString(w._sequence_actor_name(i)),
    }));
    const cameraActor = actors.find((a: any) => a.kind === 0)?.i,
      doorActor = actors.find((a: any) => a.kind === 3 && a.name === 'ENV_shsb_hous001_door001')?.i,
      playerActor = actors.find((a: any) => a.kind === 4 && a.name === 'HM_plr0_main0_def')?.i;
    if ([cameraActor, doorActor, playerActor].some((i: any) => i === undefined))
      throw Error('La secuencia carece de pistas obligatorias');
    const events = Array.from({ length: w._sequence_event_count() }, (_: any, i: any) => ({
      i,
      frame: w._sequence_event_start(i),
      type: w._sequence_event_type(i),
      functor: w._sequence_event_functor(i),
      soundId: w._sequence_event_sound(i),
    }));
    const sample = (actor: any, frame: any) => {
      const p = w._sequence_sample(actor, 0, frame);
      if (!p) throw Error('Pista original sin muestra');
      return w.HEAPF32.slice(p / 4, p / 4 + 8);
    };
    const originalDoor = baseVertices.slice(
        exit.vertexFirst * 6,
        (exit.vertexFirst + exit.vertexCount) * 6,
      ),
      doorInverse = inverseRigid(exit.matrix);
    await cycle.prepare(destination, async (floor: any) => ({ floor }));
    const host: any = {
      ambient,
      cycle,
      photoPrepared: false,
      blocking: [],
      phase: 'walking',
      floor: 'f010',
      frame: 0,
      completed: false,
      ready: false,
      active: false,
      log: [],
      unsupported: new Set(),
      groups: scene.groups,
      vertices,
      baseLights,
      baseProbes,
      next,
      inverse,
      events,
      origin: null,
      eventCursor: 0,
      dirtyDoor: false,
      rebased: false,
    };
    function record(type: any, detail: any) {
      host.log.push({ type, detail, frame: host.frame });
      if (host.log.length > 256) host.log.shift();
    }
    function consume() {
      w._script_apply_geometry();
      const commands = Array.from({ length: w._script_command_count() }, (_: any, i: any) => ({
        name: w.UTF8ToString(w._script_command_name(i)),
        args: Array.from({ length: w._script_command_arg_count(i) }, (_: any, j: any) =>
          w.UTF8ToString(w._script_command_arg(i, j)),
        ),
      }));
      w._script_commands_clear();
      for (const { name, args } of commands) {
        record(name, args);
        if (name === 'LoadStage') {
          if (
            !args[0]?.endsWith('/hallway/pt14_hallway.fpk') ||
            args.slice(1).join('|') !== 'next|startDoor|current|endDoor'
          )
            throw Error('Etapa solicitada no compatible');
          host.ready = true;
          host.rebased = false;
          for (const { placement, owner } of nextOwners)
            w._world_owner_active(owner, w._scene_model_visible(placement.modelIndex) ? 1 : 0);
        } else if (name === 'Skip') {
          if (!ambient.stop(args[0])) cycle.fail('Skip desconocido: ' + args[0]);
        } else if (name === 'SetCondition') {
          if (args[0] !== 'PhotoPrepare' || w._scene_photo_prepare() <= 0)
            cycle.fail('Condición original pendiente: ' + args[0]);
          host.photoPrepared = true;
        } else if (name === 'ActivateStage') host.active = true;
        else if (name === 'GeomActive') {
          for (const { placement, owner } of nextOwners)
            if (placement.name === args[0])
              w._world_owner_active(
                owner,
                args[1] === '1' && !(placement === entry && host.phase === 'sequence') ? 1 : 0,
              );
        } else if (name === 'ChangeStageId' || name === 'UnloadStage') {
        } // Commit the coordinate-frame change after the camera track ends.
        else if (!host.audio?.command(name, args)) host.unsupported.add(name);
      }
      if (w._script_command_count()) consume();
    }
    function message(name: any, id: any = 'gc_p00_010') {
      const result = withString(w, id, (d: any) =>
        withString(w, name, (m: any) => w._script_demo_message(d, m)),
      );
      if (result < 0) throw Error('Mensaje original no compatible: ' + name);
      consume();
      record('message', id === 'gc_p00_010' ? name : id + ':' + name);
    }
    function visibility() {
      for (const g of host.groups) {
        if (g.demoActor) continue;
        g.visible = (!g.stage || host.ready) && !!w._scene_model_visible(g.modelIndex);
        if (g.stage && g.modelIndex === entry.modelIndex) g.visible = false;
        if (g.stage && host.rebased) g.visible = false;
        if (!g.stage && g.modelIndex === exit.modelIndex && host.phase === 'sequence')
          g.visible = true;
      }
    }
    ambient.message = (id: any, name: any) => message(name, id);
    host.attachAudio = (audio: any) => {
      host.audio = audio;
      ambient.audio = audio;
      for (const e of host.log)
        if (audio.command(e.type, e.detail)) host.unsupported.delete(e.type);
    };
    host.collectMenuPhoto = () => {
      if (!w._scene_photo_collect_option()) return false;
      consume();
      visibility();
      host.dirtyDoor = true;
      return true;
    };
    host.bindGroups = (groups: any) => {
      host.groups = groups;
      ambient.bindGroups(groups);
      visibility();
    };
    host.tick = (position: any, yaw: any, move: any = [0, 0]) => {
      for (const [name, on] of host.audio?.bgmStates || [])
        withString(w, name, (p: any) => w._script_bgm_state(p, on));
      if (cycle.phase === 'blocked') throw cycle.error;
      const count = w._events_tick(...position, Math.atan2(Math.sin(yaw), -Math.cos(yaw)), ...move);
      let start;
      for (let i = 0; i < count; i++) {
        const kind = w.UTF8ToString(w._event_kind(i)),
          target = w.UTF8ToString(w._event_target(i));
        if (kind === 'GeoTrapScriptCallbackDataElement') {
          const code = w._script_exec_request(i);
          if (code < 0) throw Error(w.UTF8ToString(w._script_last_error()));
        } else if (target === 'gc_p00_010' && ['walking', 'active'].includes(host.phase)) {
          if (host.floor === 'f005') {
            host.blocking = [...host.unsupported].map((name: any) => 'comando pendiente ' + name);
            if (ambient.players.get('gc_p01_070').state !== 'finished')
              host.blocking.push('secuencia del baño gc_p01_070');
            if (!host.photoPrepared) host.blocking.push('PhotoPrepare');
            if (ambient.players.get('gc_p04_310').state !== 'stopped')
              host.blocking.push('parada original de cucarachas');
            if (host.blocking.length) {
              record('pending', host.blocking.join(', '));
              w._event_retry(i);
              continue;
            }
          } else if (host.floor === 'f020') {
            host.blocking = [...host.unsupported].map((name: any) => 'comando pendiente ' + name);
            if (ambient.players.get('gc_p01_081').state !== 'finished')
              host.blocking.push('secuencia del baño gc_p01_081');
            if (host.blocking.length) {
              record('pending', host.blocking.join(', '));
              w._event_retry(i);
              continue;
            }
          } else if (host.floor === 'f030') {
            host.blocking = ['Interacción de mirada y secuencia gc_p01_021 pendientes'];
            record('pending', host.blocking[0]);
            continue;
          } else if (host.floor !== 'f010') {
            cycle.fail('Etapa fuera del hito: ' + host.floor);
          }
          start = {
            index: i,
            matrix: w.HEAPF32.slice(w._event_matrix(i) / 4, w._event_matrix(i) / 4 + 16),
          };
        } else if (ambient.players.has(target)) {
          const p = w._event_matrix(i) / 4;
          if (ambient.play(target, w.HEAPF32.slice(p, p + 16))) {
            w._event_ack(i, 1);
            record('sequence', target);
          }
        } else if (target)
          cycle.fail(
            w.UTF8ToString(w._event_condition(i)) +
              ' → ' +
              target +
              ' (reproductor obligatorio pendiente)',
          );
      }
      consume();
      if (start) {
        if (!host.ready) throw Error('La siguiente etapa aún no está preparada');
        host.cameraBlend = new NativeCameraBlend(
          ambient.metadata.get('gc_p00_010'),
          host.cameraPose,
        );
        host.origin = start.matrix;
        host.phase = 'sequence';
        host.frame = 0;
        host.eventCursor = 0;
        message('Play');
        w._event_ack(start.index, 1);
        for (const { placement, owner } of nextOwners)
          if (placement === entry) w._world_owner_active(owner, 0);
        record('sequence', 'gc_p00_010');
        if (host.audio)
          host.audio.sequence(events).catch((e: any) => {
            host.audioError = e;
          });
      }
      visibility();
    };
    host.update = (dt: any) => {
      ambient.update(dt);
      if (ambient.dirty) {
        host.dirtyDoor = true;
        ambient.dirty = false;
      }
      if (host.phase !== 'sequence') return null;
      if (host.audioError) throw host.audioError;
      host.frame = Math.min(
        frames,
        host.audio
          ? (host.audio.sequenceSeconds ?? 0) * DEMO_FPS
          : host.frame + Math.max(0, dt) * DEMO_FPS,
      );
      while (host.eventCursor < events.length && events[host.eventCursor].frame <= host.frame) {
        const e = events[host.eventCursor++];
        record('stream', e);
        if (e.soundId && !host.audio) host.unsupported.add('sequence audio');
      }
      const f = Math.max(1, Math.min(127, host.frame)),
        cam = sample(cameraActor, f),
        root = sample(playerActor, Math.min(f, 126)),
        door = sample(doorActor, f),
        cm = multiply(host.origin, rotation(cam)),
        direction = transformPoint(cm, [0, 0, -1], 0);
      const camera = transformPoint(host.origin, cam.subarray(4, 7)),
        position = transformPoint(host.origin, root.subarray(4, 7));
      const dm = multiply(multiply(host.origin, rotation(door)), doorInverse),
        animated = transformVertices(originalDoor, dm);
      vertices.set(animated, exit.vertexFirst * 6);
      tangents.set(
        transformTangents(
          baseTangents.subarray(exit.vertexFirst * 4, (exit.vertexFirst + exit.vertexCount) * 4),
          dm,
        ),
        exit.vertexFirst * 4,
      );
      host.dirtyDoor = true;
      let view: any = {
        camera,
        position,
        yaw: Math.atan2(direction[0], -direction[2]),
        pitch: Math.asin(Math.max(-1, Math.min(1, direction[1]))),
        basis: { right: [...cm.slice(0, 3)], up: [...cm.slice(4, 7)] },
        fov: 2 * Math.atan(6.75 / w._sequence_focal(f)),
      };
      view = host.cameraBlend?.apply(view, host.frame) || view;
      // Keep the native triggers supplied with the demo-controlled player position.
      host.tick(position, view.yaw);
      if (host.frame >= frames) {
        message('FinishMotion');
        message('PlayEnd');
        message('Finish');
        const sourceFloor = host.floor;
        const localPosition = transformPoint(inverse, position),
          floor = w._world_floor(localPosition[0], localPosition[1] + 0.5, localPosition[2]);
        if (!Number.isFinite(floor) || Math.abs(floor - localPosition[1]) > 0.25)
          throw Error('No hay suelo original en el destino de la secuencia');
        // Coordinate handoff is not proof that every event of the source floor ran.
        cycle.transfer(() => {});
        if (sourceFloor === 'f020') {
          ambient.stop('gc_p04_340', { notify: false });
          ambient.update(0);
        }
        withString(w, cycle.current.floor, (p: any) => w._script_set_floor(p));
        w._events_reset();
        for (const name of ['condition_Light', 'condition_Setup_Sound', 'condition_0001'])
          withString(w, 'pt14_hallway|pt14_hallway_demo|common_demo|' + name, (p: any) => {
            if (w._script_exec_condition(p) < 0) throw Error('No se pudo activar f005');
          });
        consume();
        for (const { owner } of nextOwners) w._world_owner_active(owner, 0);
        vertices.set(originalDoor, exit.vertexFirst * 6);
        tangents.set(
          baseTangents.subarray(exit.vertexFirst * 4, (exit.vertexFirst + exit.vertexCount) * 4),
          exit.vertexFirst * 4,
        );
        const localDirection = transformPoint(inverse, direction, 0);
        view = {
          ...view,
          camera: transformPoint(inverse, view.camera),
          basis: view.basis
            ? {
                right: transformPoint(inverse, view.basis.right, 0),
                up: transformPoint(inverse, view.basis.up, 0),
              }
            : null,
          position: localPosition,
          yaw: Math.atan2(localDirection[0], -localDirection[2]),
          transferred: true,
          completed: false,
        };
        w._player_spawn(...localPosition);
        host.phase = 'active';
        host.floor = cycle.current.floor;
        host.completed = false;
        host.rebased = true;
        visibility();
        record('transferred', sourceFloor + ' → ' + host.floor);
        host.audio?.finish();
        if (['f005', 'f020'].includes(host.floor)) {
          host.ready = false;
          host.active = false;
          const destination = w.UTF8ToString(w._script_next_floor());
          host.preparation = cycle.prepare(destination, async (floor: any) => ({ floor }));
          host.preparation.catch((error: any) => {
            host.audioError = error;
          });
        }
      }
      return view;
    };
    consume();
    host.tick(scene.spawn.position, scene.spawn.yaw);
    visibility();
    // Adjacent geometry is prefetched once. The user's archive is not copied or re-uploaded.
    host.destroy = () => {
      ambient.destroy();
      cycle.destroy();
      for (const { owner } of nextOwners) w._world_owner_active(owner, 0);
    };
    return host;
  } catch (error) {
    ambient.destroy();
    cycle.destroy();
    throw error;
  }
}

// Original starting-room presentation and exit. The renderer commits the prepared
// hallway only after the native exit track and destination-floor validation.
export async function prepareOpening(w: any, scene: any, file: any) {
  const { SequencePlayer, SequenceClock } = await import('../sequences/sequence-player');
  const { loadDemoResources } = await import('../sequences/demo-resources');
  const resources = await loadDemoResources(w, file),
    clock = new SequenceClock(),
    players = new Map();
  const locator = (suffix: any) => {
    for (let i = 0; i < w._locator_count(); i++)
      if (w.UTF8ToString(w._locator_name(i)).endsWith('|' + suffix)) {
        const p = w._locator_matrix(i) / 4;
        return w.HEAPF32.slice(p, p + 16);
      }
    throw Error('Opening locator missing: ' + suffix);
  };
  const origin = locator('LocatorStartPlayerPos'),
    doorOrigin = locator('LocatorStartDoorPos');
  let ambient;
  try {
    for (const id of ['gc_p00_022', 'gc_p00_020', 'gc_p00_160']) {
      const meta = resources.metadata.get(id);
      if (!meta) throw Error('Missing opening ' + id);
      players.set(id, new SequencePlayer(w, resources.read(meta.demoStreamPath), id, clock));
    }
    ambient = await prepareDemoActors(w, scene, file, ['gc_p01_100', 'gc_p02_510']);
    let current = players.get('gc_p00_022'),
      groups = scene.groups,
      started = false,
      next = null,
      exiting = false,
      exitPrepared = false,
      disposed = false;
    const closed = scene.placements.find((p: any) => p.name.endsWith('_door001_close'));
    const doorVertices = scene.vertices.slice(
        closed.vertexFirst * 6,
        (closed.vertexFirst + closed.vertexCount) * 6,
      ),
      doorTangents = scene.tangents.slice(
        closed.vertexFirst * 4,
        (closed.vertexFirst + closed.vertexCount) * 4,
      );
    const doorInverse = inverseRigid(closed.matrix);
    const connector = locator('Connector_door');
    const host: any = {
      opening: true,
      phase: 'sequence',
      floor: 'f000',
      frame: 1,
      origin,
      blocking: [],
      unsupported: new Set(['opening depth of field']),
      vertices: scene.vertices,
      dirtyDoor: false,
      ready: false,
      completed: false,
      fade: 1,
      focusDistance: 0,
      async attachAudio(audio: any) {
        this.audio = audio;
        ambient.audio = audio;
        if (audio.prepareStream)
          await audio.prepareStream(
            'gc_p00_020',
            resources.read(resources.metadata.get('gc_p00_020').demoStreamPath),
          );
      },
      bindGroups(value: any) {
        groups = value;
        ambient.bindGroups(value);
        visibility();
      },
      connector,
      destination: w.UTF8ToString(w._script_next_floor()),
      prepareDestination: null,
      retryPreparation() {
        if (this.preparation || exitPrepared || !this.prepareDestination) return;
        this.blocking = ['Preparando pasillo'];
        this.preparation = Promise.resolve()
          .then(() => this.prepareDestination(this.destination))
          .then(
            () => {
              if (!disposed) {
                exitPrepared = true;
                this.blocking = [];
              }
            },
            (error: any) => {
              if (!disposed)
                this.blocking = [
                  'No se pudo preparar el pasillo: ' +
                    error.message +
                    ' · pulsa Jugar para reintentar',
                ];
            },
          )
          .finally(() => {
            this.preparation = null;
          });
      },
      tick(position: any, yaw: any, move: any = [0, 0]) {
        if (this.phase !== 'walking') return;
        const count = w._events_tick(
          ...position,
          Math.atan2(Math.sin(yaw), -Math.cos(yaw)),
          ...move,
        );
        for (let i = 0; i < count; i++) {
          const target = w.UTF8ToString(w._event_target(i)),
            kind = w.UTF8ToString(w._event_kind(i));
          if (target === 'gc_p00_160') {
            if (!exitPrepared) {
              w._event_retry(i);
              if (!this.blocking.length) this.retryPreparation();
              continue;
            }
            this.cameraBlend = new NativeCameraBlend(
              resources.metadata.get(target),
              this.cameraPose,
            );
            this.origin = w.HEAPF32.slice(w._event_matrix(i) / 4, w._event_matrix(i) / 4 + 16);
            exiting = true;
            this.exiting = true;
            current = players.get(target);
            current.play();
            this.phase = 'sequence';
            this.frame = 1;
            message(target, 'Play');
            w._event_ack(i, 1);
            this.audio?.sequence(current.events).catch((error: any) => {
              this.audioError = error;
            });
          } else if (kind === 'GeoTrapScriptCallbackDataElement') {
            if (w._script_exec_request(i) < 0) throw Error(w.UTF8ToString(w._script_last_error()));
            for (let j = 0; j < w._script_command_count(); j++) {
              const name = w.UTF8ToString(w._script_command_name(j));
              if (name !== 'ActivateStage') throw Error('Opening trigger command pending: ' + name);
            }
            w._script_commands_clear();
          } else if (target) throw Error('Opening trigger pending: ' + target);
        }
      },
      destroy() {
        disposed = true;
        ambient.destroy();
        for (const p of players.values()) p.destroy();
      },
      selectPlayer() {
        w._sequence_select(current.handle);
      },
      update(dt: any) {
        if (this.audioError) throw this.audioError;
        if (!this.audio?.active) return this.phase === 'sequence' ? view() : null;
        if (this.phase !== 'sequence') return null;
        if (!started) {
          current.play();
          ambient.play('gc_p02_510', origin);
          started = true;
        }
        if (exiting && 'sequenceSeconds' in this.audio) {
          if (this.audio.sequenceSeconds === null) return view();
          clock.seconds = current.started + this.audio.sequenceSeconds;
        } else clock.advance(dt);
        current.update(dispatch);
        ambient.update(dt);
        for (const command of ambient.unresolved) this.unsupported.add(command);
        if (ambient.dirty) {
          this.dirtyDoor = true;
          ambient.dirty = false;
        }
        if (next) {
          current = players.get(next);
          next = null;
          current.play();
          this.audio.playStream?.(current.name);
          current.update(dispatch);
        }
        this.frame = Math.max(1, Math.min(current.length - 1, current.frame));
        this.selectPlayer();
        this.fade = exiting
          ? 0
          : Math.max(0, 1 - current.frame / DEMO_FPS / Math.max(0.001, this.fadeSeconds || 1));
        if (exiting) {
          const door = current.sample(current.actors.find((a: any) => a.kind === 3).index),
            local = rotation(door);
          local.set(door.subarray(4, 7), 12);
          const matrix = multiply(multiply(this.origin, local), doorInverse);
          scene.vertices.set(transformVertices(doorVertices, matrix), closed.vertexFirst * 6);
          scene.tangents.set(transformTangents(doorTangents, matrix), closed.vertexFirst * 4);
          this.dirtyDoor = true;
        }
        visibility();
        const result = view();
        if (current.state === 'finished') {
          const root = current.sample(current.actors.find((a: any) => a.kind === 4).index),
            position = transformPoint(this.origin, root.subarray(4, 7));
          if (exiting) {
            for (const name of ['FinishMotion', 'PlayEnd', 'Finish']) message(current.name, name);
            this.phase = 'handoff';
            result.exit = { position, connector: this.connector, destination: this.destination };
            return result;
          }
          const floor = w._world_floor(position[0], position[1] + 0.5, position[2]);
          if (!Number.isFinite(floor) || Math.abs(floor - position[1]) > 0.3)
            throw Error('Opening ends outside the original floor');
          message('gc_p00_020', 'Finish');
          this.phase = 'walking';
          this.fade = 0;
          w._player_spawn(...position);
          result.position = position;
          result.transferred = true;
          result.opening = true;
        }
        return result;
      },
    };
    function setModel(suffix: any, visible: any) {
      const p = scene.placements.find((p: any) => p.name.endsWith(suffix));
      if (!p) throw Error('Missing opening prop ' + suffix);
      w._scene_model_visibility(p.modelIndex, visible ? 1 : 0);
      if (p.owner) w._world_owner_active(p.owner, visible ? 1 : 0);
      host.dirtyDoor = true;
    }
    // SetupStartRoomDoor / SetupOpeningOcho for f000. The original door sequence
    // replaces the closed static model, then hands back to the 20-degree variant.
    setModel('_door001_close', true);
    setModel('_door001_open_20', false);
    setModel('_ocho001_0000', true);
    function visibility() {
      for (const g of groups)
        if (!g.demoActor)
          g.visible =
            exiting && g.modelIndex === closed.modelIndex
              ? true
              : !!w._scene_model_visible(g.modelIndex);
    }
    function message(id: any, name: any) {
      if (
        withString(w, id, (d: any) =>
          withString(w, name, (m: any) => w._script_demo_message(d, m)),
        ) < 0
      )
        throw Error('Opening script failed: ' + id + ':' + name);
      w._script_apply_geometry();
      for (let i = 0; i < w._script_command_count(); i++) {
        const n = w.UTF8ToString(w._script_command_name(i));
        if (!['GeomActive', 'ChangeGameStep'].includes(n))
          throw Error('Opening command pending: ' + n);
        if (n === 'ChangeGameStep' && w.UTF8ToString(w._script_command_arg(i, 0)) !== 'StartGame')
          throw Error('Unexpected opening game step');
      }
      w._script_commands_clear();
      visibility();
      host.dirtyDoor = true;
    }
    ambient.message = (id: any, name: any) => message(id, name);
    function dispatch(e: any) {
      const f = e.functor,
        type = Number(e.type);
      if (f === 0xcee2edd67199n) {
        const code = BigInt.asUintN(64, w._sequence_event_string(e.index, 0x73f3ece4)).toString();
        const name = ['OpenDoor20', 'FinishMotion', 'hideOcho'].find(
          (n: any) => resources.code(n) === code,
        );
        if (!name) throw Error('Unknown opening message ' + code);
        if (name === 'OpenDoor20') ambient.play('gc_p01_100', doorOrigin);
        else if (name === 'FinishMotion' && current.name === 'gc_p00_022') next = 'gc_p00_020';
        else message(current.name, name);
      } else if (f === 0xfa384e14ab0en) {
        host.fadeSeconds = current.use(() => w._sequence_event_float(e.index, 0xa85b4a35));
      } else if (f === 0x7d2cda51f34an) {
        host.focusDistance = w._sequence_event_float(e.index, 0x90c1d608);
      } else if (e.soundId && !exiting) {
        host.audio.sequence([{ ...e, frame: 0 }]).catch((error: any) => {
          host.audioError = error;
        });
      } else if (e.soundId && exiting) {
      } // Scheduled once on the shared audio clock.
      else if (![0n, 0x9fe662692727n, 0x7cbf30bccfc2n, 0xbfa41f9e6521n].includes(f))
        throw Error('Opening functor pending: ' + f.toString(16));
      else if (
        f === 0n &&
        ![
          0x966d8ec3, 0x3148f136, 0xd3185dff, 0x7f4d8e71, 0xc5806267, 0x3e09e7b9, 0x2a36c514,
          0xf4603510, 0x75586ee7, 0xd2a6999a,
        ].includes(type)
      )
        throw Error('Opening event pending: ' + type.toString(16));
    }
    function view() {
      current.frame = Math.max(1, current.frame);
      const cam = current.sample(current.actors.find((a: any) => a.kind === 0).index),
        m = multiply(host.origin, rotation(cam)),
        direction = transformPoint(m, [0, 0, -1], 0);
      const result = {
        camera: transformPoint(host.origin, cam.subarray(4, 7)),
        yaw: Math.atan2(direction[0], -direction[2]),
        pitch: Math.asin(Math.max(-1, Math.min(1, direction[1]))),
        basis: { right: [...m.slice(0, 3)], up: [...m.slice(4, 7)] },
        fov: current.use(() => 2 * Math.atan(6.75 / w._sequence_focal(Math.max(1, current.frame)))),
      };
      return host.cameraBlend?.apply(result, current.frame) || result;
    }
    visibility();
    host.selectPlayer();
    return host;
  } catch (e) {
    ambient?.destroy();
    for (const p of players.values()) p.destroy();
    throw e;
  }
}

export function openingHandoff(view: any, connector: any, worldFloor: any) {
  if (!view?.exit || !connector) throw Error('Faltan conectores de salida');
  const halfTurn = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
  const matrix = multiply(multiply(connector, halfTurn), inverseRigid(view.exit.connector));
  const position = transformPoint(matrix, view.exit.position),
    direction = transformPoint(matrix, [Math.sin(view.yaw), 0, -Math.cos(view.yaw)], 0);
  const floor = worldFloor(position[0], position[1] + 0.5, position[2]);
  if (!Number.isFinite(floor) || Math.abs(floor - position[1]) > 0.3)
    throw Error('La salida no coincide con el suelo original del pasillo');
  return {
    position,
    camera: transformPoint(matrix, view.camera),
    yaw: Math.atan2(direction[0], -direction[2]),
    pitch: view.pitch,
    fov: view.fov,
  };
}
