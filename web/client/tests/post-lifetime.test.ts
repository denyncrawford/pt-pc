import test from 'node:test';
import assert from 'node:assert/strict';
import {createPost} from '../postprocess.js';
// Command recording test: validates lifetime/order; actual WGSL validation is a browser check.
test('AO precedes bloom; resizing and three post sessions release all owned GPU allocations',async()=>{
 const previous={GPUTextureUsage:globalThis.GPUTextureUsage,GPUBufferUsage:globalThis.GPUBufferUsage,GPUShaderStage:globalThis.GPUShaderStage};
 Object.assign(globalThis,{GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},GPUBufferUsage:{UNIFORM:1,COPY_DST:2,STORAGE:4},GPUShaderStage:{FRAGMENT:1,COMPUTE:2}});
 const live=new Set(),commands=[];
 const allocation=()=>{const r={createView:()=>({}),destroy:()=>live.delete(r)};live.add(r);return r;};
 const device={createTexture:allocation,createBuffer:allocation,queue:{writeBuffer(){},writeTexture(){}},createSampler:()=>({}),createBindGroupLayout:()=>({}),createBindGroup:()=>({}),createPipelineLayout:()=>({}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createRenderPipelineAsync:async (d: any)=>({name:d.fragment.entryPoint}),createComputePipelineAsync:async (d: any)=>({name:d.compute.entryPoint})};
 const pass=()=>({setPipeline:(p: any)=>commands.push(p.name),setBindGroup(){},draw(){},dispatchWorkgroups(){},end(){}}),encoder={beginRenderPass:pass,beginComputePass:pass};
 const settings={min:-10,max:1,compensation:0,key:1,add:[-4.8,-3.8,-2.4],ev:[0,-3,-5],weight:1.2,extraction:3,size:2};
 try{for(let cycle=0;cycle<3;cycle++){
  const post=await createPost(device,'bgra8unorm',{lut:new Uint8Array(16384),floors:{f010:settings}});
  post.resize(640,360);const baseline=live.size;post.resize(1280,720);assert.equal(live.size,baseline);post.resize(1280,720);assert.equal(live.size,baseline);
  commands.length=0;post.render(encoder,{},1/60,'f010',{createView:()=>({})},new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,-1,0]),true,()=>commands.push('emissive'));
  assert.deepEqual(commands.slice(0,9),['measure','adapt','occlusion','occlusionBlur','occluded','emissive','reflectionMake','reflectionBlend','bright']);assert.equal(commands.at(-1),'compose');
  post.destroy();post.destroy();assert.equal(live.size,0);
 }}finally{Object.assign(globalThis,previous);}
});
