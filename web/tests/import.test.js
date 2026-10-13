import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import createGeometry from '../dist/geometry.js';
import {Psarc,parseFpk,fpkEntry,discoverModels,readSlice} from '../archives.js';
import {triangleFmdl,fpk,psarc} from './fixtures.js';
const wasm=await createGeometry({wasmBinary:readFileSync(new URL('../dist/geometry.wasm',import.meta.url))});
function decode(bytes){const p=wasm._malloc(bytes.length);wasm.HEAPU8.set(bytes,p);try{return wasm._decode_fmdl(p,bytes.length);}finally{wasm._free(p);}}
test('WASM decodes known triangle positions, normals and indices',()=>{
  assert.equal(decode(triangleFmdl()),0);assert.equal(wasm._vertex_count(),3);assert.equal(wasm._index_count(),3);
  assert.deepEqual([...wasm.HEAPU32.slice(wasm._index_ptr()/4,wasm._index_ptr()/4+3)],[0,1,2]);
  assert.deepEqual([...wasm.HEAPF32.slice(wasm._vertex_ptr()/4,wasm._vertex_ptr()/4+6)],[-1,0,0,0,0,1]);
});
test('WASM rejects truncated input, invalid indices and non-finite vertices; recovers',()=>{
  for(const length of [0,1,63,104,200,333])assert.notEqual(decode(triangleFmdl().slice(0,length)),0);
  const bad=triangleFmdl();new DataView(bad.buffer).setUint16(328,65535,true);assert.notEqual(decode(bad),0);assert.equal(wasm._vertex_count(),0);
  const nan=triangleFmdl();new DataView(nan.buffer).setFloat32(256,NaN,true);assert.notEqual(decode(nan),0);
  assert.equal(decode(triangleFmdl()),0);
});
test('WASM decodes individually encrypted FPK entry using upstream StrCode64',()=>{
  // Key independently calculated with upstream tools/foxhash.py for test.fmdl.
  const key=[0x5e,0xc1,0x08,0xe1,0x30,0xca,0xff,0xff],plain=new Uint8Array(335);plain.set(triangleFmdl());
  const encrypted=new Uint8Array(336);encrypted[0]=0x1b;
  for(let i=0;i<plain.length;i++){encrypted[i+1]=key[i%8]^plain[i];key[i%8]=plain[i];}
  const name=new TextEncoder().encode('/Assets/TEST.FMDL\0'),p=wasm._malloc(encrypted.length),n=wasm._malloc(name.length);
  try {wasm.HEAPU8.set(encrypted,p);wasm.HEAPU8.set(name,n);const size=wasm._decrypt_entry(p,encrypted.length,n);
    assert.equal(size,334);assert.equal(wasm._decode_fmdl(p,size),0);
  }finally{wasm._free(p);wasm._free(n);}
});
test('WASM accepts float16 normals',()=>{
  const bytes=triangleFmdl(),d=new DataView(bytes.buffer);bytes[197]=6;
  for(let i=0;i<3;i++) {d.setUint16(268+i*24,0,true);d.setUint16(270+i*24,0,true);d.setUint16(272+i*24,0x3c00,true);d.setUint16(274+i*24,0,true);}
  assert.equal(decode(bytes),0);assert.deepEqual([...wasm.HEAPF32.slice(wasm._vertex_ptr()/4+3,wasm._vertex_ptr()/4+6)],[0,0,1]);
});
test('FPK extracts the exact model bytes and rejects out-of-range entries',()=>{
  assert.deepEqual(fpkEntry(parseFpk(fpk()),'test.fmdl'),triangleFmdl());
  const bad=fpk();new DataView(bad.buffer).setUint32(48,0xffffffff,true);assert.throws(()=>parseFpk(bad));
});
test('local PSARC → compressed FPK → FMDL → WASM end to end',async()=>{
  const file=new File([psarc()],'chunk1.psarc');const archive=await new Psarc(file).open();assert.equal(archive.names.size,1);
  const models=await discoverModels([file]);assert.equal(models.length,1);assert.equal(decode(await models[0].read()),0);
});
test('file reads stay bounded and reject oversized/out-of-range requests',async()=>{
  const file=new File([new Uint8Array(4)],'test');await assert.rejects(readSlice(file,3,2));await assert.rejects(readSlice(file,0,129*1024*1024));
});
test('bad PSARC header and truncated block fail explicitly',async()=>{
  await assert.rejects(new Psarc(new File([new Uint8Array(32)],'bad.psarc')).open());
  await assert.rejects(new Psarc(new File([psarc().slice(0,-8)],'bad.psarc')).open().then(a=>a.readIndex(1)));
});
