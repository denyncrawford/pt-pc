import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';import {loadHallway} from '../runtime.js';import {Qar,uploadMaterials} from '../materials.js';
test('scripted hallway retains all FOX2 props, frames and pictures at authored texture resolution',{skip:!(process.env.PT_TEST_PSARC&&process.env.PT_TEST_QAR)},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true});
 for(const l of scene.lights){assert.equal(l.data.length,28);assert.ok(l.data.every(Number.isFinite));assert.ok(l.data[22]>=0&&l.data[22]<=1);}
 assert.ok(scene.lights.some(l=>l.data[20]!==0||l.data[21]!==0),'authored shadow offsets reach the browser');
 console.log('Shadow parameters: '+JSON.stringify(scene.lights.filter(l=>l.data[15]).map(l=>({name:l.name,values:[...l.data.slice(20,25)]}))));
 assert.equal(scene.placements.length,143);assert.equal(new Set(scene.placements.map(p=>p.modelIndex)).size,143);
 for(const re of [/shsb_hous001_ches003/,/shsb_pctr001/,/shsb_hous001_pict006/,/shsb_radi001/])assert.ok(scene.placements.some(p=>re.test(p.model)));
 assert.ok(scene.vertices.every(Number.isFinite));assert.equal(scene.tangents.length,scene.vertices.length/6*4);assert.ok(scene.tangents.every(Number.isFinite));assert.ok(scene.tangents.some(x=>x!==0));
 const qar=await new Qar(Bun.file(process.env.PT_TEST_QAR),w,file).open();let live=0;const descriptors=[],uploads=[];
 globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};
 const resource=()=>{live++;return {createView(){return {};},destroy(){live--;}};};
 const d={features:new Set(['texture-compression-bc']),limits:{maxTextureDimension2D:8192},createSampler:()=>({}),createTexture:desc=>{descriptors.push(desc);return resource();},createBuffer:resource,createBindGroup:()=>({}),queue:{writeTexture(dst,data,layout,size){uploads.push({level:dst.mipLevel||0,size});},writeBuffer(){}}};
 const surface=await uploadMaterials(d,{getBindGroupLayout:()=>({})},qar,scene.groups,()=>{});
 assert.deepEqual(surface.missing,[]);assert.equal(surface.tableFallback,false);assert.ok(!scene.pendingCollisions.some(n=>n.endsWith("lobby_open")));assert.ok(surface.bytes>0);assert.ok(surface.count>280);
 assert.ok(descriptors.some(t=>t.size[0]>=2048&&t.mipLevelCount>1));assert.ok(descriptors.some(t=>t.format.startsWith('bc')));assert.ok(uploads.some(u=>u.level>5));
 for(const r of [...surface.textures,...surface.buffers])r.destroy();assert.equal(live,0);
 console.log('Complete static scene: '+JSON.stringify({placements:scene.placements.length,tangentFallback:scene.placements.reduce((n,p)=>n+p.tangentFallback,0),vertices:scene.vertices.length/6,textures:surface.count,textureBytes:surface.bytes}));
});
