// Static FOX2 lighting preset, cached omnidirectional shadows and local reflection captures.
export const MAX_LIGHTS = 128,
  SHADOW_SIZE = 512,
  REFLECTION_SIZE = 256;
export function selectLights(wasm: any, preset: any = 'ID10') {
  const lights = [];
  for (let i = 0; i < wasm._light_count(); i++) {
    const name = wasm.UTF8ToString(wasm._light_name(i));
    if (preset && !name.includes('_light_' + preset + '|')) continue;
    const p = wasm._light_data(i) / 4,
      data = wasm.HEAPF32.slice(p, p + 28);
    if ((preset || data[16]) && data[18] > 0 && data[3] > 0) lights.push({ name, data });
  }
  if (!lights.length || lights.length > MAX_LIGHTS) throw Error('Conjunto de luces no compatible');
  return lights;
}
export function multiply(a: any, b: any) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
const dot = (a: any, b: any) => a.reduce((n: any, v: any, i: any) => n + v * b[i], 0),
  cross = (a: any, b: any) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm = (a: any) => a.map((v: any) => v / Math.hypot(...a));
export function faceMatrix(eye: any, face: any, far: any = 50) {
  const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ],
    ups = [
      [0, -1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
      [0, -1, 0],
    ];
  const f = dirs[face],
    r = norm(cross(f, ups[face])),
    u = cross(r, f),
    v = new Float32Array([
      r[0],
      u[0],
      -f[0],
      0,
      r[1],
      u[1],
      -f[1],
      0,
      r[2],
      u[2],
      -f[2],
      0,
      -dot(r, eye),
      -dot(u, eye),
      dot(f, eye),
      1,
    ]);
  const near = 0.025;
  return multiply(
    new Float32Array([
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
      far / (near - far),
      -1,
      0,
      0,
      (far * near) / (near - far),
      0,
    ]),
    v,
  );
}
export const lightingWGSL = `
var<private> measuredDiffuse:vec3<f32>;
var<private> shadowPixel:vec2<f32>;
var<private> receiverNormal:vec3<f32>;
struct Light { positionRange:vec4<f32>, intensity:vec4<f32>, directionCone:vec4<f32>, params:vec4<f32>, flags:vec4<f32>, shadow:vec4<f32>, shadowCone:vec4<f32> };
struct Lighting { config:vec4<f32>, probe:vec4<f32>, lights:array<Light,128> };
@group(2) @binding(0) var<uniform> lighting:Lighting;
@group(2) @binding(1) var<storage,read> lightMatrices:array<mat4x4<f32>>;
@group(2) @binding(2) var shadowMap:texture_depth_2d_array;
@group(2) @binding(3) var shadowSampler:sampler_comparison;
@group(2) @binding(4) var reflectionMap:texture_2d_array<f32>;
@group(2) @binding(5) var reflectionSampler:sampler;
struct Probe { box:mat4x4<f32>, positive:vec4<f32>, negative:vec4<f32>, sh:array<vec4<f32>,9> };
@group(2) @binding(6) var<storage,read> probes:array<Probe>;
@group(2) @binding(7) var mirrorMap:texture_2d<f32>;
struct Mirror { vp:mat4x4<f32>, plane:vec4<f32>, config:vec4<f32> };
@group(2) @binding(8) var<uniform> mirror:Mirror;
fn evaluateSH(probe:Probe,n:vec3<f32>)->vec3<f32>{return probe.sh[0].rgb+probe.sh[1].rgb*n.y+probe.sh[2].rgb*n.z+probe.sh[3].rgb*n.x+probe.sh[4].rgb*n.x*n.y+probe.sh[5].rgb*n.y*n.z+probe.sh[6].rgb*(3.0*n.z*n.z-1.0)+probe.sh[7].rgb*n.x*n.z+probe.sh[8].rgb*(n.x*n.x-n.y*n.y);}
fn sphereTexel(probe:Probe,texel:vec2<f32>,axes:mat3x3<f32>)->vec3<f32>{
 let s=(texel+0.5)/16.0;let t=vec2(2.0*s.x-1.0,1.0-2.0*s.y);let len2=dot(t,t);let z=min(1.0,2.0*len2-1.0);
 let xy=vec2(-t.x,t.y)*inverseSqrt(max(len2,0.000001))*sqrt(max(0.0,1.0-z*z));let w=axes*vec3(xy,z);return evaluateSH(probe,vec3(-w.x,-w.z,w.y));
}
// Original 16x16 Lambert sphere-map lookup, including its 13/16 sampling radius.
fn sphereLookup(probe:Probe,normal:vec3<f32>)->vec3<f32>{
 let r=normalize(vec3(frame.vp[0].x,frame.vp[1].x,frame.vp[2].x));let u=normalize(vec3(frame.vp[0].y,frame.vp[1].y,frame.vp[2].y));let back=cross(r,u)*select(1.0,-1.0,frame.forward.w>1.5);let axes=mat3x3(r,u,back);let n=transpose(axes)*normal;
 let radius=0.40625*sqrt(max(0.0,0.5*n.z+0.5));let len=length(n.xy);let dir=select(vec2(1.0,0.0),n.xy/max(len,0.000001),len>0.0);let texel=(0.5-radius*dir)*16.0-0.5;let base=floor(texel);let f=fract(texel);
 return mix(mix(sphereTexel(probe,base,axes),sphereTexel(probe,base+vec2(1,0),axes),f.x),mix(sphereTexel(probe,base+vec2(0,1),axes),sphereTexel(probe,base+vec2(1,1),axes),f.x),f.y);
}
fn indirect(p:vec3<f32>,normal:vec3<f32>)->vec3<f32>{
 var total=vec3(0.0);
 for(var i=0u;i<u32(lighting.probe.w);i++){
  let probe=probes[i];let q=(probe.box*vec4(p,1)).xyz;
  let f=min(clamp((1.0-q)*probe.positive.xyz,vec3(0),vec3(1)),clamp((1.0+q)*probe.negative.xyz,vec3(0),vec3(1)));let weight=f.x*f.y*f.z;
  if(weight<=0.0){continue;}
  let e=sphereLookup(probe,normal);
  total=total*(1.0-weight)+max(e,vec3(0))*weight;
 }return total;
}
fn mirrorColor(p:vec3<f32>)->vec3<f32>{let clip=mirror.vp*vec4(p,1);let uv=clip.xy/clip.w*vec2(0.5,-0.5)+0.5;return textureSampleLevel(mirrorMap,reflectionSampler,clamp(uv,vec2(0),vec2(1)),0).rgb;}

fn cubeFace(d:vec3<f32>)->u32{let a=abs(d);if(a.x>=a.y&&a.x>=a.z){return select(1u,0u,d.x>0.0);}if(a.y>=a.z){return select(3u,2u,d.y>0.0);}return select(5u,4u,d.z>0.0);}
fn visibility(i:u32,p:vec3<f32>,n:vec3<f32>)->f32{
 let light=lighting.lights[i];if(light.flags.x<0.0||lighting.config.y<0.5){return 1.0;}
 let layer=u32(light.flags.x)*6u+cubeFace(p-light.positionRange.xyz);
 let right=normalize(vec3(frame.vp[0].x,frame.vp[1].x,frame.vp[2].x));let up=normalize(vec3(frame.vp[0].y,frame.vp[1].y,frame.vp[2].y));
 let forward=-cross(right,up)*select(1.0,-1.0,frame.forward.w>1.5);
 var receiver=p-forward*light.shadow.x;
 var shadowCone=1.0;
 if(light.directionCone.w>=0.0){receiver=p+forward*light.shadow.y+light.directionCone.xyz*light.shadow.x;let sc=clamp((dot(normalize(p-light.positionRange.xyz),light.directionCone.xyz)-light.shadow.w)*light.shadowCone.x,0.0,1.0);shadowCone=sc*sc;}
 // A grazing cinematic view can move the native view bias behind the receiver.
 // Keep its tangential displacement, but never push it through its own triangle.
 let normal=receiverNormal*select(-1.0,1.0,dot(receiverNormal,n)>=0.0);
 receiver-=normal*min(0.0,dot(receiver-p,normal));
 let clip=lightMatrices[layer]*vec4(receiver,1);let ndc=clip.xyz/clip.w;let uv=ndc.xy*vec2(0.5,-0.5)+0.5;
 if(any(uv<vec2(0))||any(uv>vec2(1))||ndc.z>1.0){return 1.0;}
 // shaders/lighting.glsl: original frame-fixed four-tap pattern, adapted to forward-Z cube faces.
 let texel=1.0/vec2<f32>(textureDimensions(shadowMap));
 let d=select(vec2(-1.0),vec2(1.0),fract(0.5*(shadowPixel-0.5))>=vec2(0.3));
 var sum=0.0;
 for(var tap=0u;tap<4u;tap++){
  let offsets=array<vec2<f32>,4>(vec2(.5,-.5),vec2(-.5,-.5),vec2(-.5,.5),vec2(.5,.5));
  sum+=textureSampleCompareLevel(shadowMap,shadowSampler,clamp(uv+(offsets[tap]+.125*d)*texel,texel,vec2(1)-texel),i32(layer),ndc.z);
 }
 let visibility=1.0-shadowCone*(1.0-sum*.25);return 1.0+light.shadow.z*(visibility*visibility-1.0);
}
fn sceneLighting(p:vec3<f32>,n:vec3<f32>,eye:vec3<f32>,albedo:vec3<f32>,spec:vec3<f32>,translucency:f32,strand:vec3<f32>,shift:f32)->vec3<f32>{
 measuredDiffuse=indirect(p,n);var radiance=albedo*measuredDiffuse;let view=normalize(eye-p);
 for(var i=0u;i<u32(lighting.config.x);i++){
  let light=lighting.lights[i];let delta=light.positionRange.xyz-p;let dist=length(delta);if(dist>light.positionRange.w){continue;}
  let l=delta/max(dist,0.001);var cone=1.0;
  if(light.directionCone.w>=0.0){cone=pow(clamp((dot(-l,light.directionCone.xyz)-light.directionCone.w)/max(light.params.x-light.directionCone.w,0.0001),0.0,1.0),max(light.params.y,0.01));}
  let d=select(max(light.params.z,dist)+light.intensity.w,max(light.params.z,dist+light.intensity.w),light.directionCone.w>=0.0);let d2=max(d*d,0.01);let range=light.positionRange.w;let attenuation=max(0.0,1.0/d2-d2/pow(range,4.0));
  let diffuse=max(0.0,dot(n,l));let h=normalize(l+view);var shine=pow(max(0.0,dot(n,h)),mix(8.0,96.0,clamp(spec.g,0.0,1.0)))*spec.r*light.flags.y;
  if(material.repeat.z>0.5){
   // lighting.glsl: finite source size bends only the specular half-vector.
   let ray=reflect(-view,n)-l;
   let k=clamp(clamp(0.9*light.flags.w/max(d,1e-6),0.0,1.0)/max(length(ray),1e-6),0.0,1.0);
   let ls=normalize(l+ray*k);let hs=normalize(ls+view);
   let response=nativeResponse(max(0.0,dot(n,hs)),spec.g,clamp(dot(hs,l),0.0,1.0),dot(n,l),translucency);
   measuredDiffuse+=response.a*max(light.intensity.rgb,vec3(0))*attenuation*cone*visibility(i,p,n);
   radiance+=(albedo*response.a+spec.r*response.rgb*light.flags.y)*max(light.intensity.rgb,vec3(0))*attenuation*cone*visibility(i,p,n);
  }else{measuredDiffuse+=diffuse*max(light.intensity.rgb,vec3(0))*attenuation*cone*visibility(i,p,n);radiance+=(albedo*diffuse+vec3(shine))*max(light.intensity.rgb,vec3(0))*attenuation*cone*visibility(i,p,n);}

 }
 return radiance;
}
fn reflected(p:vec3<f32>,n:vec3<f32>,eye:vec3<f32>,spec:vec3<f32>)->vec3<f32>{
 if(lighting.config.z<0.5||(frame.forward.w>0.5&&frame.forward.w<1.5)){return vec3(0);}
 var dir=reflect(normalize(p-eye),n);
 // Box projection keeps the corridor capture attached to the walls instead of the eye.
 let lo=vec3(-0.7,-1.4,-6.2);let hi=vec3(0.7,1.6,7.8);
 if(all(p>lo)&&all(p<hi)){let safe=select(vec3(0.00001),dir,abs(dir)>vec3(0.00001));let far=max((lo-p)/safe,(hi-p)/safe);let travel=min(far.x,min(far.y,far.z));dir=p+dir*travel-lighting.probe.xyz;}
 let face=cubeFace(dir);let matrix=lightMatrices[u32(lighting.config.w)+face];
 let clip=matrix*vec4(lighting.probe.xyz+dir,1);let uv=clip.xy/clip.w*vec2(0.5,-0.5)+0.5;
 if(material.repeat.z>0.5){let k=selectedParams.z*(1.0-spec.b)+spec.b;let amount=selectedParams.z*k;return textureSampleLevel(reflectionMap,reflectionSampler,uv,i32(face),5.0*(1.0-spec.b)).rgb*spec.r*amount*selectedParams.x*k*selectedColor.rgb;}
 let fresnel=0.015+0.12*pow(1.0-max(0.0,dot(n,normalize(eye-p))),5.0);
 return textureSampleLevel(reflectionMap,reflectionSampler,uv,i32(face),1.0+(1.0-clamp(spec.g,0.0,1.0))*5.0).rgb*fresnel*clamp(spec.r,0.0,1.0);
}
`;
export async function createLighting(device: any) {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth', viewDimension: '2d-array' },
      },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  return {
    layout,
    prepare: async (
      mesh: any,
      frameLayout: any,
      capturePipeline: any,
      lights: any,
      probes: any,
      plane: any,
      baseCounts: any = { lights: lights.length, probes: probes.length },
    ) => {
      const resources = [],
        keep = (r: any) => (resources.push(r), r);
      let mirrorEnabled = true,
        activeProbes = probes.length;
      device.pushErrorScope('validation');
      let scopeOpen = true;
      try {
        const shadowLights = lights.filter((l: any) => l.data[15]),
          layers = Math.max(1, shadowLights.length * 6),
          matrices = new Float32Array((layers + 6) * 16);
        if (layers > device.limits.maxTextureArrayLayers)
          throw Error('La GPU no admite las capas de sombra de esta escena');
        const probe = [0, 0, 3.5];
        for (let i = 0; i < shadowLights.length; i++)
          for (let f = 0; f < 6; f++)
            matrices.set(
              faceMatrix(shadowLights[i].data.slice(0, 3), f, Math.max(1, shadowLights[i].data[3])),
              (i * 6 + f) * 16,
            );
        for (let f = 0; f < 6; f++) matrices.set(faceMatrix(probe, f), (layers + f) * 16);
        const lightData = new Float32Array(8 + 128 * 28);
        lightData.set([lights.length, 1, 1, layers, ...probe, probes.length]);
        lights.forEach((l: any, i: any) => {
          lightData.set(l.data, 8 + i * 28);
          lightData[8 + i * 28 + 16] = l.data[15] ? shadowLights.indexOf(l) : -1;
        });
        const buffer = keep(
          device.createBuffer({
            size: lightData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          }),
        );
        device.queue.writeBuffer(buffer, 0, lightData);
        const mb = keep(
          device.createBuffer({
            size: matrices.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          }),
        );
        device.queue.writeBuffer(mb, 0, matrices);
        const shadow = keep(
          device.createTexture({
            size: [SHADOW_SIZE, SHADOW_SIZE, layers],
            format: 'depth32float',
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_SRC,
          }),
        );
        const bodyShadow = keep(
          device.createTexture({
            size: [SHADOW_SIZE, SHADOW_SIZE, layers],
            format: 'depth32float',
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST,
          }),
        );
        let shadowRevision = 0,
          bodyRevision = -1,
          staticRevision = -1,
          captureDirty = false;
        const reflection = keep(
          device.createTexture({
            size: [REFLECTION_SIZE, REFLECTION_SIZE, 6],
            format: 'rgba16float',
            mipLevelCount: 9,
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.STORAGE_BINDING,
          }),
        );
        const placeholder = keep(
          device.createTexture({
            size: [1, 1, 6],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING,
          }),
        );
        const ss = device.createSampler({
            compare: 'less-equal',
            minFilter: 'linear',
            magFilter: 'linear',
          }),
          rs = device.createSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
          });
        const group = (t: any, m: any, depth: any = shadow) =>
          device.createBindGroup({
            layout,
            entries: [
              { binding: 0, resource: { buffer } },
              { binding: 1, resource: { buffer: mb } },
              { binding: 2, resource: depth.createView({ dimension: '2d-array' }) },
              { binding: 3, resource: ss },
              { binding: 4, resource: t.createView({ dimension: '2d-array' }) },
              { binding: 5, resource: rs },
              { binding: 6, resource: { buffer: pb } },
              {
                binding: 7,
                resource: m.createView({ dimension: '2d', baseArrayLayer: 0, arrayLayerCount: 1 }),
              },
              { binding: 8, resource: { buffer: mirrorBuffer } },
            ],
          });
        const pb = keep(
          device.createBuffer({
            size: Math.max(240, probes.length * 240),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          }),
        );
        const pd = new Float32Array(Math.max(60, probes.length * 60));
        probes.forEach((p: any, i: any) => pd.set(p.data, i * 60));
        device.queue.writeBuffer(pb, 0, pd);
        const mirrorTexture = keep(
          device.createTexture({
            size: [512, 512],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          }),
        );
        const mirrorDepth = keep(
          device.createTexture({
            size: [512, 512],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          }),
        );
        const mirrorBuffer = keep(
          device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          }),
        );
        const mirrorFrame = keep(
          device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          }),
        );
        const mirrorFrameGroup = device.createBindGroup({
          layout: frameLayout,
          entries: [{ binding: 0, resource: { buffer: mirrorFrame } }],
        });
        const mainGroup = group(reflection, mirrorTexture),
          captureGroup = group(placeholder, placeholder),
          mirrorGroup = group(reflection, placeholder, bodyShadow);
        const sl = device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
        });
        const sm = device.createShaderModule({
          code: `@group(0) @binding(0) var<uniform> vp:mat4x4<f32>;@group(1) @binding(0) var s:sampler;@group(1) @binding(1) var base:texture_2d<f32>;@group(1) @binding(4) var<uniform> params:array<vec4<f32>,6>;struct Out{@builtin(position)p:vec4<f32>,@location(0)uv:vec2<f32>};@vertex fn vs(@location(0)p:vec3<f32>,@location(2)uv:vec2<f32>)->Out{var o:Out;o.p=vp*vec4(p,1);o.uv=uv;return o;}@fragment fn fs(o:Out){if(textureSample(base,s,o.uv).a<select(params[0].x,0.5,params[3].z>0.5&&params[0].x!=0.0)){discard;}}`,
        });
        // WebGPU forward-Z cube-map rasterization needs slope-scaled depth separation
        // for the PCF footprint, particularly native lights with zero shadowBias.
        // This is a rasterization correction, separate from native per-light offsets.
        const sp = await device.createRenderPipelineAsync({
          layout: device.createPipelineLayout({
            bindGroupLayouts: [sl, capturePipeline.getBindGroupLayout(1)],
          }),
          vertex: {
            module: sm,
            entryPoint: 'vs',
            buffers: [
              {
                arrayStride: 24,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
              },
              {
                arrayStride: 24,
                attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }],
              },
            ],
          },
          fragment: { module: sm, entryPoint: 'fs', targets: [] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: 'depth32float',
            depthWriteEnabled: true,
            depthCompare: 'less',
            depthBias: 2,
            depthBiasSlopeScale: 2,
          },
        });
        const encoder = device.createCommandEncoder();
        const shadowGroups = Array.from({ length: layers }, (_: any, layer: any) => {
          const ub = keep(
            device.createBuffer({
              size: 64,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
          );
          device.queue.writeBuffer(ub, 0, matrices.subarray(layer * 16, layer * 16 + 16));
          return device.createBindGroup({
            layout: sl,
            entries: [{ binding: 0, resource: { buffer: ub } }],
          });
        });
        function refreshShadows(encoder: any) {
          shadowRevision++;
          captureDirty = true;
          for (let layer = 0; layer < layers; layer++) {
            const pass = encoder.beginRenderPass({
              colorAttachments: [],
              depthStencilAttachment: {
                view: shadow.createView({
                  dimension: '2d',
                  baseArrayLayer: layer,
                  arrayLayerCount: 1,
                }),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
              },
            });
            pass.setPipeline(sp);
            pass.setBindGroup(0, shadowGroups[layer]);
            pass.setVertexBuffer(0, mesh.vb);
            pass.setVertexBuffer(1, mesh.uvb);
            pass.setIndexBuffer(mesh.ib, 'uint32');
            for (const g of mesh.surface.groups)
              if (g.visible !== false && !g.decal && !g.mirror && !g.emissive) {
                pass.setBindGroup(1, g.binding);
                pass.drawIndexed(g.count, 1, g.first);
              }
            pass.end();
          }
        }
        refreshShadows(encoder);
        const rd = keep(
          device.createTexture({
            size: [REFLECTION_SIZE, REFLECTION_SIZE],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          }),
        );
        const captureFrames = Array.from({ length: 6 }, (_: any, face: any) => {
          const data = new Float32Array(24);
          data.set(matrices.subarray((layers + face) * 16, (layers + face + 1) * 16));
          data.set([...probe, 1], 16);
          data[23] = 1;
          const ub = keep(
            device.createBuffer({
              size: 96,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
          );
          device.queue.writeBuffer(ub, 0, data);
          return device.createBindGroup({
            layout: frameLayout,
            entries: [{ binding: 0, resource: { buffer: ub } }],
          });
        });
        const mipModule = device.createShaderModule({
          code: `@group(0) @binding(0) var source:texture_2d_array<f32>;@group(0) @binding(1) var dest:texture_storage_2d_array<rgba16float,write>;
 @compute @workgroup_size(8,8,1) fn main(@builtin(global_invocation_id) id:vec3<u32>){let size=textureDimensions(dest);if(id.x>=size.x||id.y>=size.y){return;}let p=vec2<i32>(id.xy)*2;let layer=i32(id.z);let c=(textureLoad(source,p,layer,0)+textureLoad(source,p+vec2(1,0),layer,0)+textureLoad(source,p+vec2(0,1),layer,0)+textureLoad(source,p+vec2(1,1),layer,0))*0.25;textureStore(dest,vec2<i32>(id.xy),layer,c);}`,
        });
        const mp = await device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module: mipModule, entryPoint: 'main' },
        });
        function refreshCapture(encoder: any) {
          for (let face = 0; face < 6; face++) {
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: reflection.createView({
                    dimension: '2d',
                    baseArrayLayer: face,
                    arrayLayerCount: 1,
                    baseMipLevel: 0,
                    mipLevelCount: 1,
                  }),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
              depthStencilAttachment: {
                view: rd.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'discard',
              },
            });
            pass.setPipeline(capturePipeline);
            pass.setBindGroup(0, captureFrames[face]);
            pass.setBindGroup(2, captureGroup);
            pass.setVertexBuffer(0, mesh.vb);
            pass.setVertexBuffer(1, mesh.uvb);
            pass.setIndexBuffer(mesh.ib, 'uint32');
            for (const g of mesh.surface.groups)
              if (g.visible !== false && !g.decal && !g.mirror) {
                pass.setBindGroup(1, g.binding);
                pass.drawIndexed(g.count, 1, g.first);
              }
            pass.end();
          }
          for (let mip = 1; mip < 9; mip++) {
            const group = device.createBindGroup({
              layout: mp.getBindGroupLayout(0),
              entries: [
                {
                  binding: 0,
                  resource: reflection.createView({
                    dimension: '2d-array',
                    baseMipLevel: mip - 1,
                    mipLevelCount: 1,
                  }),
                },
                {
                  binding: 1,
                  resource: reflection.createView({
                    dimension: '2d-array',
                    baseMipLevel: mip,
                    mipLevelCount: 1,
                  }),
                },
              ],
            });
            const pass = encoder.beginComputePass();
            pass.setPipeline(mp);
            pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(
              Math.ceil((REFLECTION_SIZE >> mip) / 8),
              Math.ceil((REFLECTION_SIZE >> mip) / 8),
              6,
            );
            pass.end();
          }
          captureDirty = false;
        }
        refreshCapture(encoder);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        const validation = await device.popErrorScope();
        scopeOpen = false;
        if (validation) throw Error(validation.message);
        return {
          transition: true,
          setTransition(active: any) {
            if (this.transition === active) return;
            this.transition = active;
            captureDirty = true;
            lightData[0] = active ? lights.length : baseCounts.lights;
            activeProbes = active ? probes.length : baseCounts.probes;
            lightData[7] = activeProbes;
            device.queue.writeBuffer(buffer, 0, lightData);
          },
          finishTransition() {
            this.transition = false;
            captureDirty = true;
            lightData[0] = baseCounts.lights;
            activeProbes = baseCounts.probes;
            lightData[7] = activeProbes;
            device.queue.writeBuffer(buffer, 0, lightData);
          },
          refreshShadows,
          group: mainGroup,
          probes: probes.length,
          renderMirror(encoder: any, vp: any, eye: any, playerBody: any) {
            if (captureDirty) refreshCapture(encoder);
            if (!plane || !mirrorEnabled) return;
            const sign = dot(plane.slice(0, 3), eye) + plane[3] >= 0 ? 1 : -1,
              clipPlane = plane.map((v: any) => v * sign),
              r = reflectionMatrix(plane),
              mvp = multiply(vp, r);
            if (bodyRevision !== (playerBody?.revision || 0) || staticRevision !== shadowRevision) {
              encoder.copyTextureToTexture(
                { texture: shadow, aspect: 'depth-only' },
                { texture: bodyShadow, aspect: 'depth-only' },
                [SHADOW_SIZE, SHADOW_SIZE, layers],
              );
              if (playerBody?.visible && !playerBody.sequence)
                for (let layer = 0; layer < layers; layer++) {
                  const pass = encoder.beginRenderPass({
                    colorAttachments: [],
                    depthStencilAttachment: {
                      view: bodyShadow.createView({
                        dimension: '2d',
                        baseArrayLayer: layer,
                        arrayLayerCount: 1,
                      }),
                      depthLoadOp: 'load',
                      depthStoreOp: 'store',
                    },
                  });
                  pass.setPipeline(sp);
                  pass.setBindGroup(0, shadowGroups[layer]);
                  playerBody.draw(pass, true, true);
                  pass.end();
                }
              bodyRevision = playerBody?.revision || 0;
              staticRevision = shadowRevision;
            }
            const reflectedEye = [0, 1, 2].map(
              (k: any) => r[k] * eye[0] + r[4 + k] * eye[1] + r[8 + k] * eye[2] + r[12 + k],
            );
            const data = new Float32Array(24);
            data.set(mvp);
            data.set(clipPlane, 16);
            data[20] = 1;
            device.queue.writeBuffer(mirrorBuffer, 0, data);
            data.set([...reflectedEye, 1], 16);
            data.set([0, 0, 0, 2], 20);
            device.queue.writeBuffer(mirrorFrame, 0, data);
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: mirrorTexture.createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
              depthStencilAttachment: {
                view: mirrorDepth.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'discard',
              },
            });
            pass.setPipeline(capturePipeline);
            pass.setBindGroup(0, mirrorFrameGroup);
            pass.setBindGroup(2, mirrorGroup);
            pass.setVertexBuffer(0, mesh.vb);
            pass.setVertexBuffer(1, mesh.uvb);
            pass.setIndexBuffer(mesh.ib, 'uint32');
            for (const g of mesh.surface.groups)
              if (g.visible !== false && !g.mirror && !g.decal) {
                pass.setBindGroup(1, g.binding);
                pass.drawIndexed(g.count, 1, g.first);
              }
            playerBody?.draw(pass, true);
            pass.end();
          },
          lights: lights.length,
          shadows: shadowLights.length,
          setFeatures(shadows: any, reflections: any, indirect: any = true, mirrors: any = true) {
            captureDirty = true;
            mirrorEnabled = mirrors;
            device.queue.writeBuffer(
              mirrorBuffer,
              80,
              new Float32Array([Number(mirrors), 0, 0, 0]),
            );
            lightData[7] = indirect ? activeProbes : 0;
            lightData[1] = Number(shadows);
            lightData[2] = Number(reflections);
            device.queue.writeBuffer(buffer, 0, lightData);
          },
          destroy() {
            for (const r of resources) r.destroy();
          },
        };
      } catch (error) {
        if (scopeOpen) await device.popErrorScope();
        for (const r of resources) r.destroy();
        throw error;
      }
    },
  };
}

// LPSH v3 layout and real SH basis match RenderSceneBuilder::LoadProbes/BuildProbe.
export function parseLpsh(bytes: any) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    need = (ok: any) => {
      if (!ok) throw Error('LPSH inválido');
    };
  need(bytes.length >= 176 && d.getUint32(0, true) === 3);
  const count = d.getUint32(124, true),
    table = 176 + d.getUint32(140, true) * 4;
  need(count <= 65536 && table + count * 12 <= bytes.length);
  const out = new Map();
  const half = (h: any) => {
    const e = (h >> 10) & 31,
      m = h & 1023;
    return (
      (h & 32768 ? -1 : 1) *
      (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15))
    );
  };
  const basis = [
    0.2820948, 0.4886025, 0.4886025, 0.4886025, 1.0925484, 1.0925484, 0.3153916, 1.0925484,
    0.5462742,
  ];
  for (let i = 0; i < count; i++) {
    const name = d.getUint32(table + i * 12, true),
      data = d.getUint32(table + i * 12 + 4, true),
      end = bytes.indexOf(0, name);
    need(name < bytes.length && end >= name && end - name < 4096 && data + 72 <= bytes.length);
    const sh = new Float32Array(36);
    for (let c = 0; c < 9; c++)
      for (let k = 0; k < 3; k++) {
        const v = half(d.getUint16(data + c * 8 + k * 2, true)) * basis[c];
        need(Number.isFinite(v));
        sh[c * 4 + k] = v;
      }
    out.set(new TextDecoder().decode(bytes.subarray(name, end)), sh);
  }
  return out;
}
export function reflectionMatrix(plane: any) {
  const [x, y, z, d] = plane;
  return new Float32Array([
    1 - 2 * x * x,
    -2 * y * x,
    -2 * z * x,
    0,
    -2 * x * y,
    1 - 2 * y * y,
    -2 * z * y,
    0,
    -2 * x * z,
    -2 * y * z,
    1 - 2 * z * z,
    0,
    -2 * x * d,
    -2 * y * d,
    -2 * z * d,
    1,
  ]);
}
export function mirrorPlane(vertices: any, indices: any, groups: any) {
  let best = 0,
    plane;
  for (const g of groups.filter((g: any) => g.mirror))
    for (let i = g.first; i < g.first + g.count; i += 3) {
      const a = Array.from<number>(vertices.slice(indices[i] * 6, indices[i] * 6 + 3)),
        b = Array.from<number>(vertices.slice(indices[i + 1] * 6, indices[i + 1] * 6 + 3)),
        c = Array.from<number>(vertices.slice(indices[i + 2] * 6, indices[i + 2] * 6 + 3));
      const n = cross(
          b.map((v: any, k: any) => v - a[k]),
          c.map((v: any, k: any) => v - a[k]),
        ),
        area = Math.hypot(...n);
      if (area > best) {
        best = area;
        const unit = norm(n);
        plane = [...unit, -dot(unit, a)];
      }
    }
  if (!plane) throw Error('No se encontró la superficie original del espejo');
  for (const g of groups.filter((g: any) => g.mirror))
    for (let i = g.first; i < g.first + g.count; i++) {
      const p = vertices.subarray(indices[i] * 6, indices[i] * 6 + 3);
      if (Math.abs(dot(plane.slice(0, 3), p) + plane[3]) > 0.015)
        throw Error('El espejo original no es plano');
    }
  return plane;
}
