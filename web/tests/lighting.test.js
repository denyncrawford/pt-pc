import test from 'node:test';import assert from 'node:assert/strict';import {faceMatrix,selectLights} from '../lighting.js';
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
function project(m,p){const q=Array.from({length:4},(_,r)=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);return q.slice(0,3).map(v=>v/q[3]);}
test('shadow/reflection cube cameras center all six faces and use WebGPU depth 0..1',()=>{
 const eye=[2,-1,7];for(let i=0;i<6;i++){const m=faceMatrix(eye,i,12);const p=project(m,eye.map((v,k)=>v+dirs[i][k]*3));assert.ok(Math.abs(p[0])<1e-5&&Math.abs(p[1])<1e-5);assert.ok(p[2]>0&&p[2]<1);const near=project(m,eye.map((v,k)=>v+dirs[i][k]*.025)),far=project(m,eye.map((v,k)=>v+dirs[i][k]*12));assert.ok(Math.abs(near[2])<0.0001);assert.ok(Math.abs(far[2]-1)<1e-5);}
});
test('static preview selects one original light set, never combines all game states',()=>{
 const heap=new Float32Array(112);for(let i=0;i<4;i++){heap[i*28+3]=8;heap[i*28+18]=400;}
 const names=['stage|hallway_light_ID10|a','stage|hallway_light_ID20|b','stage|hallway_light_ID10|c','stage|hallway_light_ID100|d'];
 const w={HEAPF32:heap,_light_count:()=>4,_light_name:i=>i,UTF8ToString:i=>names[i],_light_data:i=>i*112};
 assert.equal(selectLights(w).length,2);assert.equal(selectLights(w,'ID20').length,1);assert.throws(()=>selectLights(w,'ID99'));
});

test('LPSH real SH basis, table bounds and non-finite coefficients',async()=>{
 const {parseLpsh}=await import('../lighting.js');const bytes=new Uint8Array(272),d=new DataView(bytes.buffer);d.setUint32(0,3,true);d.setUint32(124,1,true);d.setUint32(176,188,true);d.setUint32(180,200,true);bytes.set(new TextEncoder().encode('LP_0000'),188);d.setUint16(200,0x3c00,true);d.setUint16(208+2,0xbc00,true);
 const sh=parseLpsh(bytes).get('LP_0000');assert.ok(Math.abs(sh[0]-.2820948)<1e-6);assert.ok(Math.abs(sh[5]+.4886025)<1e-6);assert.throws(()=>parseLpsh(bytes.subarray(0,240)),/LPSH/);d.setUint16(200,0x7c00,true);assert.throws(()=>parseLpsh(bytes),/LPSH/);
});
test('planar reflection fixes the mirror plane, reverses signed distance and is involutory',async()=>{
 const {reflectionMatrix,multiply}=await import('../lighting.js'),r=reflectionMatrix([1,0,0,4.5]),twice=multiply(r,r);for(let i=0;i<16;i++)assert.ok(Math.abs(twice[i]-(i%5===0?1:0))<1e-6);assert.equal(r[0]*-4.5+r[12],-4.5);assert.equal(r[0]*-3+r[12],-6);
});
