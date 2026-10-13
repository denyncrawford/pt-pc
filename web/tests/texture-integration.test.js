import test from 'node:test';import assert from 'node:assert/strict';import {open} from 'node:fs/promises';import {readFileSync} from 'node:fs';
import create from '../dist/geometry.js';import {loadHallway} from '../runtime.js';import {Qar,loadFtex} from '../materials.js';
async function file(path){const handle=await open(path,'r'),{size}=await handle.stat();return {handle,size,slice:(a,b)=>({arrayBuffer:async()=>{const out=new Uint8Array(b-a);let n=0;while(n<out.length){const {bytesRead}=await handle.read(out,n,out.length-n,a+n);assert.ok(bytesRead);n+=bytesRead;}return out.buffer;}})};}
test('local scene resolves every base/normal/specular texture through QAR and PFTXS',{skip:!(process.env.PT_TEST_PSARC&&process.env.PT_TEST_QAR)},async()=>{
 const psarc=await file(process.env.PT_TEST_PSARC),qarFile=await file(process.env.PT_TEST_QAR);
 try{const w=await create({wasmBinary:readFileSync(new URL('../dist/geometry.wasm',import.meta.url))});const scene=await loadHallway(w,psarc),qar=await new Qar(qarFile,w,psarc).open();
  assert.equal(scene.uvs.length,scene.vertices.length/3);assert.ok(scene.uvs.some(v=>v!==0));assert.equal(scene.groups.reduce((n,g)=>n+g.count,0),scene.indices.length);
  const paths=new Map();for(const g of scene.groups)for(const prefix of ['Base_Tex','NormalMap_Tex','SpecularMap_Tex']){const pair=Object.entries(g.material.textures).find(([k])=>k.startsWith(prefix));if(pair)paths.set(pair[1],prefix==='Base_Tex'?1024:512);}
  let decoded=0;for(const [path,limit] of paths){const t=await loadFtex(qar,path,limit);assert.equal(t.rgba.length,t.width*t.height*4);assert.ok(t.width<=limit&&t.height<=limit);decoded+=t.rgba.length;}
  assert.ok(paths.size>=120);assert.equal(qar.fallback,undefined,'all original streams resolve directly from the QAR');assert.ok(decoded<256*1024*1024);console.log(`Verified ${paths.size} original textures; ${(decoded/1048576).toFixed(1)} MiB RGBA`);
 }finally{await psarc.handle.close();await qarFile.handle.close();}
});
