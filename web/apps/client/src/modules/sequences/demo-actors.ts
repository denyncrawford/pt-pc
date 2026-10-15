import { createDemoEffects } from '../effects/demo-effects';
import { SequenceClock, SequencePlayer } from './sequence-player';
import { loadDemoResources } from './demo-resources';
import { withEntry, withString } from '../gameplay/runtime';
import { readMaterials } from '../renderer/materials';
import { readSkin } from '../player/player-body';
import { multiply } from '../renderer/lighting';
import { rotation, transformPoint } from '../gameplay/first-loop';
const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export async function prepareDemoActors(
  w: any,
  scene: any,
  file: any,
  ids: any = ['gc_p05_010', 'gc_p04_310', 'gc_p01_070'],
) {
  const visuals = createDemoEffects(w);
  const resources = await loadDemoResources(w, file).catch((error: unknown) => {
      visuals.destroy();
      throw error;
    }),
    clock = new SequenceClock(),
    players = new Map(),
    actors = [],
    meshes = [];
  let nv = scene.vertices.length / 6,
    ni = scene.indices.length;
  try {
    for (const id of ids) {
      const meta = resources.metadata.get(id);
      if (!meta) throw Error('Missing DemoData: ' + id);
      const player = new SequencePlayer(w, resources.read(meta.demoStreamPath), id, clock);
      players.set(id, player);
      player.models = new Map();
      player.origin = identity;
      player.lights = new Map<string, { name: string; data: Float32Array; dynamic: boolean }>();
      player.use(() => {
        const count = w._sequence_lights(player.length, 0);
        for (let i = 0; i < count; i++) {
          const code = w._sequence_light_name(i).toString();
          const data = w.HEAPF32.slice(
            w._sequence_light_data(i) / 4,
            w._sequence_light_data(i) / 4 + 28,
          );
          data[16] = 0;
          const light = { name: id + ':' + code, data, dynamic: true };
          player.lights.set(code, light);
          scene.lights.push(light);
        }
      });
      player.use(() => {
        for (const event of player.events)
          if (event.functor === 0xba70c25c5ca2n) {
            const effect = resources.effect(
              id,
              BigInt.asUintN(64, w._sequence_event_string(event.index, 0xc5d7e215)),
            );
            if (
              effect.nodes.some(
                (node: string) => !['FxModuleGraph', 'FxSoundCallProgramEffectNode'].includes(node),
              )
            )
              visuals.prepare(effect.path, resources.read(effect.path));
          }
      });
      for (const [name, declaredPath] of Object.entries<any>(meta.modelFiles)) {
        const code = resources.code(name);
        const used = player.use(() =>
          player.events.some(
            (event: { type: number; index: number }) =>
              [0xc5806267, 0x75586ee7, 0x3e09e7b9].includes(Number(event.type)) &&
              BigInt.asUintN(64, w._sequence_event_arg(event.index, 0)).toString() === code,
          ),
        );
        if (!used && !player.actors.some((actor: { name: string }) => actor.name === name))
          continue;
        const playerParts =
          !declaredPath && name === 'HM_plr0_main0_def'
            ? await resources.resolvePlayerModel()
            : null;
        const path = playerParts?.modelFile || declaredPath;
        const read = resources.entries.get(path) || scene.entries.get(path);
        if (!read) throw Error('Missing sequence model: ' + path);
        const skinned = player.actors.some((a: any) => a.kind === 5 && a.name === name);
        const mesh = withEntry(w, read(), path, (p: any, n: any) => {
          try {
            if (w._decode_fmdl(p, n)) throw Error('Invalid sequence FMDL: ' + path);
            const count = w._vertex_count(),
              bytes = w.HEAPU8.subarray(p, p + n),
              vertices = w.HEAPF32.slice(w._vertex_ptr() / 4, w._vertex_ptr() / 4 + count * 6),
              indices = w.HEAPU32.slice(w._index_ptr() / 4, w._index_ptr() / 4 + w._index_count()),
              uvs = w.HEAPF32.slice(w._uv_ptr() / 4, w._uv_ptr() / 4 + count * 2);
            let skin;
            if (skinned) {
              skin = readSkin(bytes, count);
              player.use(() =>
                withString(w, name, (np: any) => {
                  if (!w._sequence_bind_model(np, p, n))
                    throw Error(`Invalid actor skeleton: ${id}/${name}`);
                }),
              );
            }
            return {
              vertices,
              indices,
              uvs,
              tangents: w.HEAPF32.slice(w._tangent_ptr() / 4, w._tangent_ptr() / 4 + count * 4),
              skin,
              groups: readMaterials(bytes),
            };
          } finally {
            w._release_geometry();
          }
        });
        const actor = {
          name,
          code: resources.code(name),
          player,
          mesh,
          first: nv,
          count: mesh.vertices.length / 6,
          created: false,
          visible: false,
          index: player.actors.find((a: any) => a.name === name && a.kind === (skinned ? 4 : 3))
            ?.index,
        };
        if (actor.index === undefined) throw Error('Actor has no track: ' + name);
        player.models.set(actor.code, actor);
        actors.push(actor);
        meshes.push(mesh);
        scene.groups.push(
          ...mesh.groups.map((g: any, groupIndex: number) => ({
            ...g,
            first: g.first + ni,
            demoActor: actor,
            playerMeshChain: playerParts ? mesh.skin?.chains[groupIndex] : undefined,
            playerMeshHidden: playerParts?.hidden,
            visible: false,
          })),
        );
        nv += actor.count;
        ni += mesh.indices.length;
      }
    }
    const tangents = new Float32Array(nv * 4);
    tangents.set(scene.tangents);
    const vertices = new Float32Array(nv * 6),
      uvs = new Float32Array(nv * 2),
      indices = new Uint32Array(ni);
    vertices.set(scene.vertices);
    uvs.set(scene.uvs);
    indices.set(scene.indices);
    let vi = scene.vertices.length / 6,
      ii = scene.indices.length;
    for (const mesh of meshes) {
      vertices.set(mesh.vertices, vi * 6);
      tangents.set(mesh.tangents, vi * 4);
      uvs.set(mesh.uvs, vi * 2);
      indices.set(
        mesh.indices.map((i: any) => i + vi),
        ii,
      );
      vi += mesh.vertices.length / 6;
      ii += mesh.indices.length;
    }
    scene.tangents = tangents;
    scene.vertices = vertices;
    scene.uvs = uvs;
    scene.indices = indices;
  } catch (e) {
    visuals.destroy();
    for (const p of players.values()) p.destroy();
    throw e;
  }
  let groups = scene.groups,
    lastAudioTime = null;
  const host = {
    metadata: resources.metadata,
    players,
    clock,
    actors,
    unresolved: new Set(),
    dirty: false,
    audio: null,
    message: null,
    cameraPlayer: null as SequencePlayer | null,
    handyEnabled: false,
    cameraFocus: null as number | null,
    cameraExposure: null as number | null,
    recordedScreenEvents: new Map<string, Record<string, string | number>>(),
    bindGroups(value: any) {
      groups = value;
    },
    play(id: any, origin: any) {
      const p = players.get(id);
      if (!p) return false;
      if (p.state === 'playing') return true;
      p.origin = origin;
      p.finishSent = false;
      for (const a of p.models.values()) {
        a.created = false;
        a.visible = false;
      }
      p.play();
      // Trap callbacks may enable demo listeners later in the same batch.
      // Dispatch Play when execution begins, after the batch has been consumed.
      p.pendingPlay = true;
      return true;
    },
    stop(id: any, { notify = true }: any = {}) {
      const p = players.get(id);
      if (!p) return false;
      const wasPlaying = p.state === 'playing';
      p.stop();
      if (this.cameraPlayer === p) {
        this.cameraPlayer = null;
        this.cameraFocus = null;
        this.cameraExposure = null;
      }
      for (const light of p.lights.values()) light.data[16] = 0;
      p.pendingPlay = false;
      for (const a of p.models.values()) {
        a.created = false;
        a.visible = false;
      }
      for (const g of groups) if (g.demoActor?.player === p) g.visible = false;
      this.dirty = true;
      this.audio?.releaseEffects(id + ':');
      visuals.release(id + ':');
      if (notify && wasPlaying) this.message?.(id, 'Skip');
      return true;
    },
    update(dt: any) {
      if (this.audio) {
        if (!this.audio.active) {
          lastAudioTime = null;
          return;
        }
        const now = this.audio.time;
        dt = lastAudioTime === null ? 0 : Math.max(0, now - lastAudioTime);
        lastAudioTime = now;
      }
      visuals.step(dt);
      clock.advance(dt);
      for (const p of players.values())
        if (p.state === 'playing') {
          if (p.pendingPlay) {
            p.pendingPlay = false;
            this.message?.(p.name, 'Play');
          }
          p.update((e: any) => {
            const type = Number(e.type),
              arg = () => BigInt.asUintN(64, w._sequence_event_arg(e.index, 0)).toString(),
              actor = p.models.get(arg());
            if (type === 0xc5806267) {
              if (!actor) throw Error(`${p.name}: unresolved model`);
              actor.created = true;
              actor.visible = true;
            } else if (type === 0x75586ee7) {
              if (actor) {
                actor.created = false;
                actor.visible = false;
              }
            } else if (type === 0x3e09e7b9) {
              if (!actor) throw Error(`${p.name}: visibility event has no model`);
              actor.visible = !!w._sequence_event_enabled(e.index);
            } else if (type === 0x7f4d8e71 || type === 0xf4603510) {
              p.cameraCreated = type === 0x7f4d8e71;
            } else if (type === 0x6b491e18) {
              // Original per-mesh events are evaluated by sequence_player_group.
              if (!actor || actor.name !== 'HM_plr0_main0_def')
                throw Error('Mesh change has no handler');
            } else if (e.functor === 0x9fe662692727n) {
              this.cameraPlayer = p;
            } else if (e.functor === 0xbfa41f9e6521n) {
              // Native mesh switches are sampled below, including the player's arms.
            } else if (e.functor === 0x7d2cda51f34an) {
              this.cameraFocus = w._sequence_event_float(e.index, 0x90c1d608);
            } else if (e.functor === 0xf3f47f2c0016n) {
              this.cameraExposure = w._sequence_event_float(e.index, 0x354a96ab);
            } else if (e.functor === 0x36a45bc5da0bn) {
              this.handyEnabled = true;
            } else if (e.soundId) {
              if (!this.audio?.postId) throw Error('Missing pickup audio player');
              this.audio.postId(e.soundId);
            } else if (w._sequence_light_event(e.index)) {
              // Evaluated with native interpolation below at the shared sequence frame.
            } else if (e.functor === 0xba70c25c5ca2n) {
              const effect = resources.effect(
                p.name,
                BigInt.asUintN(64, w._sequence_event_string(e.index, 0xc5d7e215)),
              );
              const pos = w._sequence_event_position(e.index) / 4,
                position = transformPoint(p.origin, w.HEAPF32.slice(pos, pos + 3)),
                instance = w._sequence_event_string(e.index, 0xef98a387).toString();
              if (!this.audio) throw Error('Missing original audio for ' + p.name);
              if (effect.sound) this.audio.effect(p.name + ':' + instance, effect.sound, position);
              if (visuals.manifests.has(effect.path))
                visuals.spawn(
                  p.name + ':' + instance,
                  effect.path,
                  p.origin,
                  w.HEAPF32.slice(pos, pos + 3),
                );
            } else if (e.functor === 0x62b47a5b81ecn) {
              const key = p.name + ':' + w._sequence_event_string(e.index, 0xef98a387).toString();
              visuals.release(key);
              this.audio?.releaseEffects(key);
            } else if (e.functor === 0xcee2edd67199n) {
              const code = BigInt.asUintN(
                  64,
                  w._sequence_event_string(e.index, 0x73f3ece4),
                ).toString(),
                name = [
                  'FinishMotion',
                  'Play',
                  'PlayEnd',
                  'Finish',
                  'Interrupt',
                  'Skip',
                  'Start',
                  'PlayInit',
                  'OpenDoor20',
                  'hideOcho',
                  'InvisibleStaticModel',
                  'PadEnable',
                  'DisableOption',
                  'Endf120',
                  'PlayRadio',
                  'PlayGimmick',
                  'enable_vfx_dust_glass',
                  'enable_voice_breath',
                  'GotoGameOver',
                ].find((n: any) => resources.code(n) === code);
              if (!name) throw Error(`${p.name}: unknown message ${code}`);
              if (name === 'FinishMotion' && !p.finishSent) {
                this.message?.(p.name, name);
                p.finishSent = true;
              } else if (
                ![
                  'FinishMotion',
                  'Play',
                  'PlayEnd',
                  'Finish',
                  'Interrupt',
                  'Skip',
                  'Start',
                ].includes(name)
              ) {
                this.message?.(p.name, name);
              }
            } else if (e.functor === 0x22cfa19e5213n) {
              // DemoSystem::RunFunctor records this unhandled native command.
              // Its two string parameters have no numeric/vector screen values.
              this.recordedScreenEvents.set(
                p.name + ':' + e.index,
                JSON.parse(w.UTF8ToString(w._sequence_event_diagnostic(e.index))),
              );
            } else if (e.functor !== 0n)
              throw Error(
                `${p.name} @${e.frame}: functor ${e.functor.toString(16)} is required but unsupported`,
              );
            else if (![0xd3185dff, 0x966d8ec3, 0x3148f136, 0x2a36c514, 0xd2a6999a].includes(type))
              throw Error(
                `${p.name} @${e.frame}: event ${type.toString(16)} is required but unsupported`,
              );
          });
          p.use(() => {
            const ptr = w._malloc(64);
            try {
              w.HEAPF32.set(p.origin, ptr / 4);
              const count = w._sequence_lights(p.frame, ptr);
              for (let i = 0; i < count; i++) {
                const light = p.lights.get(w._sequence_light_name(i).toString());
                const data = w._sequence_light_data(i) / 4;
                light.data.set(w.HEAPF32.subarray(data, data + 28));
                if (p.state !== 'playing') light.data[16] = 0;
              }
            } finally {
              w._free(ptr);
            }
          });
          for (const a of p.models.values())
            if (a.created) {
              let palette;
              if (a.mesh.skin) {
                p.use(() => {
                  const mp = w._malloc(64);
                  try {
                    w.HEAPF32.set(p.origin, mp / 4);
                    const count = withString(w, a.name, (np: any) =>
                      w._sequence_model_skin(np, p.frame, mp),
                    );
                    if (count <= a.mesh.skin.maxJoint) throw Error('Incomplete actor palette');
                    const ptr = w._sequence_model_skin_ptr() / 4;
                    palette = w.HEAPF32.slice(ptr, ptr + count * 16);
                  } finally {
                    w._free(mp);
                  }
                });
              } else {
                const sample = p.sample(a.index);
                if (!sample) throw Error('Actor track has no sample');
                const m = rotation(sample);
                m.set(sample.subarray(4, 7), 12);
                palette = multiply(p.origin, m);
              }
              const source = a.mesh.vertices,
                skin = a.mesh.skin,
                weights = skin && new Float32Array(skin.packed),
                joints = skin && new Uint32Array(skin.packed);
              const blended = skin ? new Float32Array(16) : null;
              for (let i = 0; i < a.count; i++) {
                let m = palette;
                if (skin) {
                  m = blended;
                  m.fill(0);
                  for (let k = 0; k < 4; k++)
                    for (let j = 0; j < 16; j++)
                      m[j] += weights[i * 8 + k] * palette[joints[i * 8 + k + 4] * 16 + j];
                }
                // Reuse scalar temporaries: no arrays/subarrays per animated vertex.
                const vi = i * 6,
                  ti = i * 4,
                  out = (a.first + i) * 6;
                const x = source[vi],
                  y = source[vi + 1],
                  z = source[vi + 2];
                const nx = source[vi + 3],
                  ny = source[vi + 4],
                  nz = source[vi + 5];
                const tx = a.mesh.tangents[ti],
                  ty = a.mesh.tangents[ti + 1],
                  tz = a.mesh.tangents[ti + 2];
                const ax = m[0] * nx + m[4] * ny + m[8] * nz;
                const ay = m[1] * nx + m[5] * ny + m[9] * nz;
                const az = m[2] * nx + m[6] * ny + m[10] * nz;
                const len = Math.hypot(ax, ay, az) || 1;
                for (let k = 0; k < 3; k++) {
                  const tangent = Math.fround(m[k] * tx + m[4 + k] * ty + m[8 + k] * tz);
                  const to = (a.first + i) * 4 + k;
                  if (scene.tangents[to] !== tangent) {
                    scene.tangents[to] = tangent;
                    this.dirty = true;
                  }
                  const position = Math.fround(m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]);
                  const normal = Math.fround((k === 0 ? ax : k === 1 ? ay : az) / len);
                  if (
                    scene.vertices[out + k] !== position ||
                    scene.vertices[out + k + 3] !== normal
                  ) {
                    scene.vertices[out + k] = position;
                    scene.vertices[out + k + 3] = normal;
                    this.dirty = true;
                  }
                }
                scene.tangents[(a.first + i) * 4 + 3] = a.mesh.tangents[ti + 3];
              }
            }
          if (p.state === 'finished') {
            if (!p.finishSent) this.message?.(p.name, 'FinishMotion');
            this.message?.(p.name, 'PlayEnd');
            this.message?.(p.name, 'Finish');
            this.audio?.releaseEffects(p.name + ':');
          }
        }
      for (const g of groups)
        if (g.demoActor && !g.demoActor.lamp && !g.demoActor.gimmick) {
          let visible = !g.stage && g.demoActor.created && g.demoActor.visible;
          if (visible && g.playerMeshChain) {
            const player = g.demoActor.player;
            visible = player.use(() =>
              g.playerMeshChain.every((name: string) =>
                withString(w, name, (ptr: number) => !!w._sequence_player_group(player.frame, ptr)),
              ),
            );
          }
          if (g.visible !== visible) {
            g.visible = visible;
            this.dirty = true;
          }
        }
    },
    visuals,
    destroy() {
      visuals.destroy();
      for (const p of players.values()) {
        this.audio?.releaseEffects(p.name + ':');
        p.destroy();
      }
      players.clear();
    },
  };
  return host;
}
