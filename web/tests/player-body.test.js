import {materialUniforms} from '../materials.js';
import test from 'node:test';import assert from 'node:assert/strict';
import create from '../dist/geometry.js';import {prepareLocomotion,withEntry,withString} from '../runtime.js';import {loadPlayerMesh,readSkin,castsPlayerShadow} from '../player-body.js';import {Psarc,parseFpk,fpkEntry} from '../archives.js';
test('skin reader rejects malformed FMDL',()=>assert.throws(()=>readSkin(new Uint8Array(64),1)));
test('original player mesh: bone palettes, animated hands, sequence and view masks',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),motion=await prepareLocomotion(w,file),m=await loadPlayerMesh(w,file);
 const skinMaterial=m.groups.find(g=>g.material.name==='skin_white_male1');
 const params=materialUniforms(skinMaterial);assert.equal(params[3],1);assert.equal(params[7],.25);assert.equal(params[8],4);
 const hair=m.groups.find(g=>g.material.shader==='fox_3ddf_hair');const hp=materialUniforms(hair);assert.equal(hp[9],1);assert.equal(hp[10],Math.fround(hair.material.vectors.Anistropic_Diffusion[0]));
 assert.ok(m.groups.some(g=>castsPlayerShadow(g.flags)&&!g.chain.includes('MESH_arm')));
 assert.equal(m.vertices.length/6,52323);assert.equal(m.maxJoint,190);assert.equal(m.tangents.length,52323*4);assert.ok(m.tangents.every(Number.isFinite));assert.ok(m.tangents.some(v=>Math.abs(v)>.5));assert.ok(m.invalidTangents<52323/100);assert.ok(m.groups.some(g=>g.chain.includes('MESH_arm')));assert.ok(m.groups.some(g=>g.chain.includes('MESH_hand_2')));
 motion.reset(-Math.PI);const palette=()=>{const n=w._locomotion_skin(0,0,0);assert.equal(n,191);const p=w._locomotion_skin_ptr()/4;return w.HEAPF32.slice(p,p+n*16);};
 motion.step(0,1,-Math.PI,1/300);const before=palette();for(let i=0;i<160;i++)motion.step(0,1,-Math.PI,1/300);const after=palette();assert.ok(after.every(Number.isFinite));
 const weights=new Float32Array(m.packed),joints=new Uint32Array(m.packed),skin=(vertex,bones)=>{const out=[0,0,0];for(let k=0;k<4;k++){const b=joints[vertex*8+4+k]*16,weight=weights[vertex*8+k];for(let c=0;c<3;c++)out[c]+=weight*(bones[b+c]*m.vertices[vertex*6]+bones[b+4+c]*m.vertices[vertex*6+1]+bones[b+8+c]*m.vertices[vertex*6+2]+bones[b+12+c]);}return out;};
 const hand=m.groups.find(g=>g.chain.includes('MESH_hand_2')),v=m.indices[hand.first],a=skin(v,before),b=skin(v,after);assert.ok(Math.hypot(...a.map((x,i)=>x-b[i]))>.005,'hand follows native animated skin');assert.ok(b.every(x=>Math.abs(x)<3));
 const archive=await new Psarc(file).open(),pkg=parseFpk(await archive.read('as/sh/level/common/resident.fpk')),path='/Assets/sh/demo/demo_stream/gc_p00_010.fsm';withEntry(w,fpkEntry(pkg,path),path,(p,n)=>w._sequence_load(p,n));const mp=w._malloc(64);try{w.HEAPF32.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],mp/4);assert.equal(w._sequence_player_skin(30,mp),191);const p=w._sequence_player_skin_ptr()/4;assert.ok(w.HEAPF32.slice(p,p+191*16).every(Number.isFinite));}finally{w._free(mp);}
 // The archive's first exit does not enable the own-body mesh; later demos may do so.
 assert.equal(withString(w,'MESH_ROOT',p=>w._sequence_player_group(30,p)),0);
});

test('authored shadow flags exclude disabled and incompatible alpha modes',()=>{
 assert.equal(castsPlayerShadow(0),true);assert.equal(castsPlayerShadow(0x20),true);
 for(const f of [0x40,0x100,0x11,0x1f])assert.equal(castsPlayerShadow(f),false);
 assert.equal(castsPlayerShadow(0x10),true);
});
test('unparameterized materials have neutral incidence and no transmission',()=>{
 const p=materialUniforms({flags:0,material:{shader:'fox_3ddf_basic'}});
 assert.equal(p.byteLength,240);assert.equal(p[3],0);assert.equal(p[7],0);assert.equal(p[9],0);assert.ok(p.every(Number.isFinite));
});
