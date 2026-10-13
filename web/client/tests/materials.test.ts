import test from 'node:test';import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';import {readFileSync} from 'node:fs';
import {decodeBlocks,loadFtex,readMaterials,parsePftxs} from '../materials.js';import create from '../dist/geometry.js';import {triangleFmdl} from './fixtures.js';
const red=new Uint8Array([0,248,0,0,0,0,0,0]);
test('BC1 colors, BC2/3 alpha, BC5 channels and partial edge blocks',()=>{
 assert.deepEqual([...decodeBlocks(red,1,1,2)],[255,0,0,255]);
 const transparent=new Uint8Array([0,0,0,248,255,255,255,255]);assert.equal(decodeBlocks(transparent,4,4,2)[3],0);
 const bc=new Uint8Array(16);bc.set(red,8);assert.equal(decodeBlocks(bc,4,4,3)[3],0);bc.fill(255,0,8);assert.equal(decodeBlocks(bc,4,4,3)[3],255);
 bc.fill(0,0,8);bc[0]=125;assert.equal(decodeBlocks(bc,4,4,4)[3],125);
 bc.fill(0);bc[0]=200;bc[8]=30;assert.deepEqual([...decodeBlocks(bc,1,1,5)],[200,30,255,255]);
 assert.throws(()=>decodeBlocks(red.subarray(0,7),4,4,2));assert.throws(()=>decodeBlocks(red,9000,1,2));
});
test('FTEX bounded zlib chunk decoding and truncated data rejection',async()=>{
 const compressed=deflateSync(red),h=new Uint8Array(88+compressed.length),d=new DataView(h.buffer);h.set(new TextEncoder().encode('FTEX'));d.setUint16(8,2,true);d.setUint16(10,4,true);d.setUint16(12,4,true);d.setUint16(14,1,true);h[16]=1;d.setUint32(28,3,true);d.setUint32(64,80,true);d.setUint32(68,8,true);d.setUint16(78,1,true);d.setUint16(80,compressed.length,true);d.setUint16(82,8,true);d.setUint32(84,8,true);h.set(compressed,88);
 const t=await loadFtex({read:async()=>h},'test');assert.equal(t.srgb,true);assert.deepEqual([...t.rgba.slice(0,4)],[255,0,0,255]);
 await assert.rejects(loadFtex({read:async()=>h.slice(0,-1)},'test'));
 assert.throws(()=>readMaterials(new Uint8Array(10)));assert.throws(()=>parsePftxs(new Uint8Array(32)));
});
test('WASM preserves half-float UVs separately from geometry',async()=>{
 const w=await create({wasmBinary:readFileSync(new URL('../dist/geometry.wasm',import.meta.url))});const b=new Uint8Array(400);b.set(triangleFmdl());const d=new DataView(b.buffer);d.setUint16(90,3,true);d.setUint32(92,212,true);b.set([0,1,0,0,2,6,12,0,8,7,20,0],340);b[185]=3;
 for(let i=0;i<3;i++){const p=256+i*24;[0,0x3c00,0,0,0x3400,0x3a00].forEach((v: any,k: any)=>d.setUint16(p+12+k*2,v,true));}
 const p=w._malloc(b.length);try{w.HEAPU8.set(b,p);assert.equal(w._decode_fmdl(p,b.length),0);assert.deepEqual([...w.HEAPF32.slice(w._uv_ptr()/4,w._uv_ptr()/4+6)],[.25,.75,.25,.75,.25,.75]);}finally{w._free(p);w._release_geometry();}
});
test('WASM preserves authored half tangents and sign, isolates nonfinite tangent fallback',async()=>{
 const w=await create(),b=new Uint8Array(420);b.set(triangleFmdl());const d=new DataView(b.buffer);d.setUint16(90,3,true);d.setUint32(92,232,true);b.set([0,1,0,0,2,6,12,0,14,6,20,0],360);b[185]=3;b[186]=28;d.setUint32(112,90,true);d.setUint32(204,84,true);d.setUint32(224,84,true);[0,1,2].forEach((v: any,i: any)=>d.setUint16(340+i*2,v,true));
 for(let i=0;i<3;i++){const p=256+i*28;[0,0x3c00,0,0xbc00].forEach((v: any,k: any)=>d.setUint16(p+20+k*2,v,true));}
 const p=w._malloc(b.length);try{w.HEAPU8.set(b,p);assert.equal(w._decode_fmdl(p,b.length),0);assert.deepEqual([...w.HEAPF32.slice(w._tangent_ptr()/4,w._tangent_ptr()/4+4)],[0,1,0,-1]);d.setUint16(256+20,0x7e00,true);w.HEAPU8.set(b,p);assert.equal(w._decode_fmdl(p,b.length),0);assert.deepEqual([...w.HEAPF32.slice(w._tangent_ptr()/4,w._tangent_ptr()/4+4)],[0,0,0,0]);}finally{w._free(p);w._release_geometry();}
});
