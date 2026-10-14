import { Psarc, parseFpk, fpkEntry } from '../../lib/archives';
import { withEntry, withString } from '../gameplay/runtime';
import { readMaterials, uploadMaterials } from '../renderer/materials';
// FMDL bone palettes are per mesh; convert their local indices to the skeleton.
export function readSkin(bytes: any, vertexCount: any) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (p: any) => d.getUint16(p, true),
    u32 = (p: any) => d.getUint32(p, true),
    f = new Map(),
    b = new Map();
  const fail = () => {
    throw Error('Pesos o grupos FMDL inválidos');
  };
  const table = u32(8),
    fc = u32(32),
    bc = u32(36);
  if (fc > 256 || bc > 256) fail();
  for (let i = 0; i < fc; i++) {
    let p = table + i * 8;
    f.set(bytes[p], { p: u32(40) + u32(p + 4), n: bytes[p + 1] * 65536 + u16(p + 2) });
  }
  for (let i = 0; i < bc; i++) {
    let p = table + fc * 8 + i * 12;
    b.set(u32(p), u32(48) + u32(p + 4));
  }
  const at = (k: any, i: any, stride: any) => {
    const t = f.get(k);
    if (!t || i < 0 || i >= t.n || t.p + (i + 1) * stride > bytes.length) fail();
    return t.p + i * stride;
  };
  const strings = [];
  for (let i = 0; i < (f.get(12)?.n || 0); i++) {
    let p = at(12, i, 8),
      start = b.get(3) + u32(p + 4),
      end = start + u16(p + 2);
    if (end > bytes.length) fail();
    strings.push(new TextDecoder().decode(bytes.subarray(start, end)));
  }
  const names = [],
    parents = [],
    meshGroup = [];
  for (let i = 0; i < (f.get(1)?.n || 0); i++) {
    let p = at(1, i, 8);
    names.push(strings[u16(p)]);
    parents.push(d.getInt16(p + 4, true));
  }
  for (let i = 0; i < (f.get(2)?.n || 0); i++) {
    let p = at(2, i, 32);
    for (let j = 0; j < u16(p + 6); j++) meshGroup[u16(p + 8) + j] = u16(p + 4);
  }
  const chains = meshGroup.map((g: any) => {
    const out = [];
    for (let depth = 0; g >= 0 && g < names.length; depth++) {
      if (depth > names.length) fail();
      out.push(names[g]);
      g = parents[g];
    }
    return out;
  });
  const tangents = new Float32Array(vertexCount * 4),
    half = (h: any) => {
      const sign = h & 32768 ? -1 : 1,
        e = (h >> 10) & 31,
        m = h & 1023;
      return (
        sign *
        (e
          ? e === 31
            ? m
              ? NaN
              : Infinity
            : 2 ** (e - 15) * (1 + m / 1024)
          : (2 ** -14 * m) / 1024)
      );
    };
  const packed = new ArrayBuffer(vertexCount * 32),
    weights = new Float32Array(packed),
    joints = new Uint32Array(packed);
  let base = 0;
  for (let m = 0; m < f.get(3).n; m++) {
    const p = at(3, m, 48),
      count = u16(p + 10),
      group = at(5, u16(p + 6), 68),
      bones = Array.from({ length: u16(group + 2) }, (_: any, i: any) => u16(group + 4 + i * 2));
    if (bones.length > 32 || base + count > vertexCount) fail();
    const lay = at(9, u16(p + 8), 8);
    let ec = u16(lay + 6);
    for (let s = 0; s < bytes[lay]; s++) {
      const st = at(10, u16(lay + 4) + s, 8),
        file = at(14, bytes[st], 16),
        stride = bytes[st + 2],
        offset = b.get(2) + u32(file + 8) + u32(st + 4);
      if (!stride || offset + count * stride > bytes.length) fail();
      for (let e = 0; e < bytes[st + 1]; e++, ec++) {
        const el = at(11, ec, 4),
          usage = bytes[el];
        if (usage === 14) {
          if (bytes[el + 1] !== 6 || u16(el + 2) + 8 > stride)
            throw Error(`Tangent format ${bytes[el + 1]} offset ${u16(el + 2)} stride ${stride}`);
          for (let v = 0; v < count; v++)
            for (let k = 0; k < 4; k++) {
              const value = half(u16(offset + v * stride + u16(el + 2) + k * 2));
              tangents[(base + v) * 4 + k] = value;
            }
          continue;
        }
        if (usage !== 1 && usage !== 7) continue;
        if (bytes[el + 1] !== (usage === 1 ? 8 : 9) || u16(el + 2) + 4 > stride) fail();
        for (let v = 0; v < count; v++)
          for (let k = 0; k < 4; k++) {
            const value = bytes[offset + v * stride + u16(el + 2) + k],
              i = (base + v) * 8;
            if (usage === 1) weights[i + k] = value / 255;
            else {
              if (value >= bones.length) fail();
              joints[i + 4 + k] = bones[value];
            }
          }
      }
    }
    base += count;
  }
  if (base !== vertexCount) fail();
  let maxJoint = 0;
  for (let v = 0; v < vertexCount; v++) {
    const i = v * 8,
      sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
    if (!(sum > 0.9 && sum < 1.1)) fail();
    for (let k = 0; k < 4; k++) {
      weights[i + k] /= sum;
      maxJoint = Math.max(maxJoint, joints[i + 4 + k]);
    }
  }
  let invalidTangents = 0;
  for (let v = 0; v < vertexCount; v++) {
    const t = tangents.subarray(v * 4, v * 4 + 4);
    if (!t.every(Number.isFinite)) {
      t.fill(0);
      invalidTangents++;
    }
  }
  return { packed, chains, maxJoint, tangents, invalidTangents };
}
export async function loadPlayerMesh(w: any, file: any) {
  const a = await new Psarc(file).open(),
    pkg = parseFpk(await a.read('as/sh/level_asset/chara/player/game_object/plparts_normal.fpk')),
    name = '/Assets/sh/chara/plr/Scenes/plr0_main0_def.fmdl';
  const helper = '/Assets/sh/chara/plr/Scenes/plr0_main0_def.frdv';
  withEntry(w, fpkEntry(pkg, helper), helper, (p: any, n: any) => {
    if (!w._locomotion_help(p, n)) throw Error('Huesos auxiliares del jugador incompatibles');
  });
  return withEntry(w, fpkEntry(pkg, name), name, (p: any, n: any) => {
    try {
      if (!w._sequence_player_skeleton(p, n)) throw Error('Esqueleto de secuencia incompatible');
      if (w._decode_fmdl(p, n)) throw Error('Malla del jugador incompatible');
      const count = w._vertex_count(),
        vertices = w.HEAPF32.slice(w._vertex_ptr() / 4, w._vertex_ptr() / 4 + count * 6),
        uvs = w.HEAPF32.slice(w._uv_ptr() / 4, w._uv_ptr() / 4 + count * 2),
        indices = w.HEAPU32.slice(w._index_ptr() / 4, w._index_ptr() / 4 + w._index_count()),
        bytes = w.HEAPU8.subarray(p, p + n),
        skin = readSkin(bytes, count),
        groups = readMaterials(bytes).map((g: any, i: any) => ({
          ...g,
          chain: skin.chains[i] || [],
        }));
      return { vertices, uvs, indices, groups, ...skin };
    } finally {
      w._release_geometry();
    }
  });
}
export function castsPlayerShadow(flags: any) {
  return (flags & 0x140) === 0 && ((flags & 0x10) === 0 || (flags & 0xf) === 0);
}
export const skinShader = `
struct Influence {weights:vec4<f32>,joints:vec4<u32>};
@group(0) @binding(0) var<storage,read> source:array<f32>;
@group(0) @binding(1) var<storage,read> influences:array<Influence>;
@group(0) @binding(2) var<storage,read> bones:array<mat4x4<f32>>;
@group(0) @binding(3) var<storage,read_write> result:array<f32>;
@group(0) @binding(4) var<storage,read> uvSource:array<f32>;
@group(0) @binding(5) var<storage,read_write> uvResult:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let v=id.x;if(v>=arrayLength(&influences)){return;}let i=v*6;let a=influences[v];
 let m=bones[a.joints.x]*a.weights.x+bones[a.joints.y]*a.weights.y+bones[a.joints.z]*a.weights.z+bones[a.joints.w]*a.weights.w;
 let p=m*vec4(source[i],source[i+1],source[i+2],1);let n=normalize((m*vec4(source[i+3],source[i+4],source[i+5],0)).xyz+vec3(1e-12));
 let q=v*6;let raw=(m*vec4(uvSource[q+2],uvSource[q+3],uvSource[q+4],0)).xyz;let t=select(vec3(0),raw/max(length(raw),1e-12),dot(raw,raw)>1e-12);
 uvResult[q]=uvSource[q];uvResult[q+1]=uvSource[q+1];uvResult[q+2]=t.x;uvResult[q+3]=t.y;uvResult[q+4]=t.z;uvResult[q+5]=uvSource[q+5];
 result[i]=p.x;result[i+1]=p.y;result[i+2]=p.z;result[i+3]=n.x;result[i+4]=n.y;result[i+5]=n.z;
}`;
export async function createPlayerBody(
  device: any,
  w: any,
  file: any,
  qar: any,
  pipeline: any,
  progress: any,
) {
  const mesh = await loadPlayerMesh(w, file),
    resources = [],
    keep = (x: any) => (resources.push(x), x);
  let surface;
  try {
    // Keep authored groups; each view applies its own visibility mask.
    const selected = mesh.groups
      .filter((g: any) => !g.material.shader.includes('shadow'))
      .map((g: any) => ({ ...g, player: true }));
    surface = await uploadMaterials(device, pipeline, qar, selected, progress);
    const buffer = (data: any, usage: any) => {
      const b = keep(
        device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST }),
      );
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    const uvData = new Float32Array(mesh.uvs.length * 3);
    for (let i = 0; i < mesh.uvs.length / 2; i++) {
      uvData.set(mesh.uvs.subarray(i * 2, i * 2 + 2), i * 6);
      uvData.set(mesh.tangents.subarray(i * 4, i * 4 + 4), i * 6 + 2);
    }
    const uvSource = buffer(uvData, GPUBufferUsage.STORAGE);
    const source = buffer(mesh.vertices, GPUBufferUsage.STORAGE),
      influence = buffer(mesh.packed, GPUBufferUsage.STORAGE),
      uv = buffer(uvData, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE),
      ib = buffer(mesh.indices, GPUBufferUsage.INDEX),
      vb = keep(
        device.createBuffer({
          size: mesh.vertices.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        }),
      );
    const palette = keep(
      device.createBuffer({
        size: 256 * 64,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );
    const compute = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: skinShader }), entryPoint: 'main' },
      }),
      binding = device.createBindGroup({
        layout: compute.getBindGroupLayout(0),
        entries: [source, influence, palette, vb, uvSource, uv].map(
          (buffer: any, binding: any) => ({ binding, resource: { buffer } }),
        ),
      });
    return {
      mesh,
      surface,
      vb,
      visible: false,
      revision: 0,
      sequence: null,
      update(encoder: any, feet: any, sequence: any) {
        this.sequence = sequence;
        this.revision++;
        let count;
        const mp = w._malloc(64);
        try {
          if (sequence) {
            w.HEAPF32.set(sequence.origin, mp / 4);
            count = w._sequence_player_skin(sequence.frame, mp);
          } else count = w._locomotion_skin(...feet);
        } finally {
          w._free(mp);
        }
        if (count <= mesh.maxJoint || count > 256) throw Error('Paleta de huesos incompatible');
        const p = (sequence ? w._sequence_player_skin_ptr() : w._locomotion_skin_ptr()) / 4;
        device.queue.writeBuffer(palette, 0, w.HEAPF32.slice(p, p + count * 16));
        const pass = encoder.beginComputePass();
        pass.setPipeline(compute);
        pass.setBindGroup(0, binding);
        pass.dispatchWorkgroups(Math.ceil(mesh.vertices.length / 6 / 64));
        pass.end();
      },
      draw(pass: any, mirror: any = false, shadow: any = false) {
        if (!this.visible || (!mirror && !this.sequence)) return;
        pass.setVertexBuffer(0, vb);
        pass.setVertexBuffer(1, uv);
        pass.setIndexBuffer(ib, 'uint32');
        for (const g of surface.groups) {
          if (shadow && !castsPlayerShadow(g.flags)) continue;
          if (this.sequence) {
            if (
              mirror ||
              !g.chain.every((name: any) =>
                withString(w, name, (p: any) => w._sequence_player_group(this.sequence.frame, p)),
              )
            )
              continue;
          } else if (g.chain.includes('MESH_arm')) continue;
          pass.setBindGroup(1, g.binding);
          pass.drawIndexed(g.count, 1, g.first);
        }
      },
      destroy() {
        for (const r of resources) r.destroy();
        for (const r of [...surface.textures, ...surface.buffers]) r.destroy();
      },
    };
  } catch (e) {
    for (const r of resources) r.destroy();
    for (const r of [...(surface?.textures || []), ...(surface?.buffers || [])]) r.destroy();
    throw e;
  }
}
