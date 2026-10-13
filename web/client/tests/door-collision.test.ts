import {test} from 'node:test';
import assert from 'node:assert/strict';
import create from '../dist/geometry.js';
import {loadHallway,stepPlayer} from '../runtime.js';
import {prepareFirstLoop} from '../first-loop.js';
test('original lobby GEOM blocks closed leaf and permits open leaf at 300 Hz input', {skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC);
 const scene=await loadHallway(w,file,()=>{},{scripts:true});
 const host=await prepareFirstLoop(w,scene,file);
 try{
  for(const p of scene.placements.filter((p: any)=>/door\d+\.fmdl$/.test(p.model)))assert.ok(p.owner,`missing collider ${p.name}`);
  const closed=scene.placements.find((p: any)=>p.name.endsWith('_lobby'));
  const open=scene.placements.find((p: any)=>p.name.endsWith('_lobby_open'));
  function cross(z: any,hz: any){w._player_spawn(-10,-1.4,z);let p;for(let i=0;i<2*hz;i++)p=stepPlayer(w,-2/hz,0,1/hz);return [...p];}
  w._world_owner_active(closed.owner,1);w._world_owner_active(open.owner,0);
  for(const hz of [60,120,300])assert.ok(cross(7.5,hz)[0]>-11.5,'cannot walk through closed lobby');
  w._world_owner_active(closed.owner,0);w._world_owner_active(open.owner,1);
  for(const z of [7.2,7.35,7.5,7.65,7.8])for(const hz of [60,120,300]){
   const p=cross(z,hz);assert.ok(p[0]<-12.5,`open door clearance at ${z}, ${hz} Hz`);assert.equal(p[3],1);
  }
  w._player_spawn(-10,-1.4,7.5);
  let ptr=w._player_draw_position()/4;assert.deepEqual([...w.HEAPF32.slice(ptr,ptr+3)],[-10,Math.fround(-1.4),7.5]);
 }finally{host.destroy();}
});
