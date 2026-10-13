import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import create from '../dist/geometry.js';import {withEntry,stepPlayer} from '../runtime.js';import {quadGeom} from './fixtures.js';
const w=await create({wasmBinary:readFileSync(new URL('../dist/geometry.wasm',import.meta.url))});
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function add(points,translation=0){const m=w._malloc(64);try{const matrix=identity.slice();matrix[12]=translation;w.HEAPF32.set(matrix,m/4);return withEntry(w,quadGeom(points),'fixture.geom',(p,n)=>w._world_add_geom(p,n,m));}finally{w._free(m);}}
function move(x,z,ticks){let p;for(let i=0;i<ticks;i++)p=stepPlayer(w,x/300,z/300);return [...p];}
test('native GEOM + character WASM: gravity, wall, sliding and transformed placement',()=>{
 w._world_clear();assert.equal(add([[-10,0,-10],[-10,0,10],[10,0,10],[10,0,-10]]),2);
 assert.equal(add([[0,0,10],[0,3,10],[0,3,-10],[0,0,-10]],2),2);assert.equal(w._world_build(),4);
 w._player_spawn(0,2,0);let p=move(0,0,900);assert.ok(Math.abs(p[1])<0.02);assert.equal(p[3],1);
 p=move(2,0,900);assert.ok(p[0]>1.4&&p[0]<1.65,'sphere stops before translated x=2 wall');
 const z=p[2];p=move(1,1,600);assert.ok(p[0]<1.65);assert.ok(p[2]>z+0.5,'moves tangentially along wall');
 w._player_spawn(0,0,0);p=move(0,0,30);assert.ok(Math.abs(p[0])<0.01,'reset clears previous contact');
});
test('WASM rejects missing FMDL-backed movement instead of accepting incomplete collisions',()=>{
 const bytes=quadGeom([[0,0,0],[1,0,0],[1,0,1],[0,0,1]]);const d=new DataView(bytes.buffer);d.setUint32(192,d.getUint32(192,true)|(0x800<<4),true);
 const m=w._malloc(64);try{w.HEAPF32.set(identity,m/4);assert.equal(withEntry(w,bytes,'missing.geom',(p,n)=>w._world_add_geom(p,n,m)),-1);}finally{w._free(m);}
});
