import type { DemoEffects } from './demo-effects';
import { loadFtex } from '../renderer/materials';
// Liquid glass subset of shaders/vfx_particle.vert/.frag. Native WASM supplies
// particle transforms, lifetime, UV animation, alpha clipping and material values.
const shader = `
struct Quad {v:array<vec4<f32>,19>};
struct Frame {vp:mat4x4<f32>,eye:vec4<f32>};
@group(0) @binding(0) var<storage,read> quads:array<Quad>;
@group(0) @binding(1) var<uniform> frame:Frame;
@group(1) @binding(0) var samp:sampler;
@group(1) @binding(1) var normalMap:texture_2d<f32>;
@group(1) @binding(2) var reflection:texture_cube<f32>;
@group(1) @binding(3) var scene:texture_2d<f32>;
struct V { @builtin(position) pos:vec4<f32>, @location(0) uv:vec4<f32>, @location(1) world:vec3<f32>, @location(2) @interpolate(flat) id:u32 };
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->V {
 let q=quads[instance]; let corners=array<u32,6>(0,2,1,1,2,3);let c=corners[vertex];
 let t=vec2<f32>(f32(c&1u),f32((c>>1u)&1u));var out:V;
 out.pos=frame.vp*vec4<f32>(q.v[c].xyz,1);out.world=q.v[c].xyz;
 out.uv=vec4<f32>(mix(q.v[4].xy,q.v[4].zw,t),mix(q.v[5].xy,q.v[5].zw,t));out.id=instance;return out;
}
fn fold(x:f32)->f32 {if(x>=.995){return abs(.995-fract(x/.995)*.995);}return abs(x);}
@fragment fn fs(i:V)->@location(0) vec4<f32> {
 let q=quads[i.id];let flags=bitcast<u32>(q.v[10].y);
 var tex=textureSample(normalMap,samp,i.uv.xy);
 let next=textureSample(normalMap,samp,i.uv.zw);
 if((flags&32u)!=0u){tex=mix(tex,next,q.v[7].w);}
 var nt=tex.rgb*2-1+vec3<f32>(0,0,.0001);var alpha=tex.a*q.v[6].a;
 if((flags&128u)!=0u){let xy=vec2<f32>(tex.a,tex.g)*2-1;nt=vec3<f32>(xy,sqrt(clamp(1-dot(xy,xy),0,1))+.0001);alpha=q.v[6].a;}
 let tangent=normalize(q.v[1].xyz-q.v[0].xyz+vec3<f32>(1e-7,0,0));
 let bitangent=normalize(q.v[0].xyz-q.v[2].xyz+vec3<f32>(0,1e-7,0));
 let norm=normalize(cross(tangent,bitangent)+vec3<f32>(0,0,1e-7));
 let n=normalize(nt.x*tangent+nt.y*bitangent+nt.z*norm);let v=normalize(i.world-frame.eye.xyz);
 let ndv=dot(n,v);let t=q.v[8].x;let through=(1-t)*clamp((1-t)*ndv+t,0,1);
 let dims=vec2<f32>(textureDimensions(scene));let offset=(i.pos.xy-.00390625-n.xy*q.v[9].y*(dims.y/1080))/dims;
 let background=textureSampleLevel(scene,samp,vec2<f32>(fold(offset.x),fold(offset.y)),0).rgb;
 let unlit=vec3<f32>(unpack2x16float(bitcast<u32>(q.v[10].w)),q.v[9].w);
 let fresnel=q.v[8].z+(1-q.v[8].z)*pow(max(1-max(-ndv,0),1e-5),q.v[8].w);
 let reflected=textureSample(reflection,samp,reflect(v,n)).rgb;
 let rgb=q.v[6].rgb+(unlit*through+t*t)*background+q.v[9].x*fresnel*reflected*reflected;
 if((flags&256u)!=0u){if(alpha<.49609375){discard;}alpha=1;}
 let distance=(frame.vp*vec4<f32>(i.world,1)).w;
 if(q.v[7].y>0 || q.v[7].z>0){alpha*=clamp((distance-q.v[7].y)/max(q.v[7].z-q.v[7].y,1e-4),0,1);}
 return vec4<f32>(rgb*clamp(alpha,0,1),clamp(alpha,0,1));
}`;
export async function createDemoEffectsRenderer(
  device: GPUDevice,
  w: any,
  effects: DemoEffects,
  qar: unknown,
) {
  const textures = new Map<string, GPUTexture>();
  let copy: GPUTexture | undefined,
    buffer: GPUBuffer | undefined,
    capacity = 0;
  let geometryGroup: GPUBindGroup | undefined;
  const materialGroups = new Map<string, GPUBindGroup>();
  const module = device.createShaderModule({ code: shader });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [
        {
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  const uniform = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });
  try {
    for (const manifest of effects.manifests.values())
      for (const shape of manifest.shapes)
        for (const [path, cube] of [
          [shape.texture, false],
          [shape.reflection, true],
        ] as const) {
          if (textures.has(path)) continue;
          const faces = await Promise.all(
            Array.from({ length: cube ? 6 : 1 }, (_, face) =>
              loadFtex(qar, path.replace(/\.ftex$/, ''), Infinity, {
                strict: true,
                ...(cube ? { face } : {}),
              }),
            ),
          );
          const first = faces[0];
          const texture = device.createTexture({
            size: [first.width, first.height, faces.length],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          textures.set(path, texture);
          faces.forEach((face, index) =>
            device.queue.writeTexture(
              { texture, origin: [0, 0, index] },
              face.rgba,
              { bytesPerRow: face.width * 4 },
              [face.width, face.height],
            ),
          );
        }
  } catch (error) {
    uniform.destroy();
    for (const texture of textures.values()) texture.destroy();
    throw error;
  }
  return {
    render(encoder: GPUCommandEncoder, target: GPUTexture, depth: GPUTexture, view: Float32Array) {
      effects.view(view);
      const count = w._vfx_quad_count();
      if (!count) return;
      if (count > capacity) {
        buffer?.destroy();
        capacity = Math.max(count, 128);
        buffer = device.createBuffer({
          size: capacity * 304,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        geometryGroup = undefined;
      }
      device.queue.writeBuffer(
        buffer!,
        0,
        w.HEAPU8.slice(w._vfx_quad_data(), w._vfx_quad_data() + count * 304),
      );
      const frame = new Float32Array(20);
      frame.set(view.subarray(12, 28));
      frame.set(view.subarray(0, 3), 16);
      device.queue.writeBuffer(uniform, 0, frame);
      if (!copy || copy.width !== target.width || copy.height !== target.height) {
        copy?.destroy();
        materialGroups.clear();
        copy = device.createTexture({
          size: [target.width, target.height],
          format: 'rgba16float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      encoder.copyTextureToTexture({ texture: target }, { texture: copy }, [
        target.width,
        target.height,
      ]);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depth.createView(), depthReadOnly: true },
      });
      pass.setPipeline(pipeline);
      geometryGroup ??= device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffer! } },
          { binding: 1, resource: { buffer: uniform } },
        ],
      });
      pass.setBindGroup(0, geometryGroup);
      const base = w._vfx_quad_data() / 4;
      for (let i = 0; i < count;) {
        const info = base + i * 76 + 40;
        const normal = w.UTF8ToString(w._vfx_texture_path(w.HEAPU32[info])),
          cube = w.UTF8ToString(w._vfx_texture_path(w.HEAPU32[info + 2]));
        const normalTexture = textures.get(normal),
          cubeTexture = textures.get(cube);
        if (!normalTexture || !cubeTexture) throw Error('Glass texture is not ready');
        const key = normal + '|' + cube;
        let group = materialGroups.get(key);
        if (!group) {
          group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(1),
            entries: [
              { binding: 0, resource: sampler },
              { binding: 1, resource: normalTexture.createView() },
              { binding: 2, resource: cubeTexture.createView({ dimension: 'cube' }) },
              { binding: 3, resource: copy.createView() },
            ],
          });
          materialGroups.set(key, group);
        }
        pass.setBindGroup(1, group);
        let end = i + 1;
        while (
          end < count &&
          w.HEAPU32[base + end * 76 + 40] === w.HEAPU32[info] &&
          w.HEAPU32[base + end * 76 + 42] === w.HEAPU32[info + 2]
        )
          end++;
        pass.draw(6, end - i, 0, i);
        i = end;
      }
      pass.end();
    },
    destroy() {
      uniform.destroy();
      buffer?.destroy();
      copy?.destroy();
      for (const texture of textures.values()) texture.destroy();
    },
  };
}
