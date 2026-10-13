import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';import {loadHallway} from '../runtime.js';import {prepareDemoActors} from '../demo-actors.js';import {SEQUENCE_FPS} from '../sequence-player.js';
test('clock, cockroaches and bathroom door execute concurrently with original transforms and sound nodes',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true}),host=await prepareDemoActors(w,scene,file),sounds=[],messages=[];
 let time=0;host.audio={active:true,get time(){return time;},effect:(key,node,position)=>sounds.push({key,node,position,time}),releaseEffects:()=>{}};host.message=(id,name)=>messages.push([id,name]);
  const beforePhoto=scene.placements.filter(p=>p.nazo);assert.ok(beforePhoto.some(p=>p.nazo==='FrameGround'));assert.equal(w._scene_photo_prepare(),7);
 for(const p of beforePhoto.filter(p=>p.nazo==='FrameWall'||p.nazo==='FrameGround'||p.nazo.startsWith('Photo')))assert.equal(w._scene_model_visible(p.modelIndex),p.nazo==='FrameGround'?1:0);
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);for(const id of host.players.keys())host.play(id,identity);
 host.update(0);const initial=scene.vertices.slice();
 for(let frame=1;frame<=3598;frame++){time=frame/SEQUENCE_FPS;host.update(1/SEQUENCE_FPS);if(frame===100){assert.notDeepEqual(scene.vertices,initial);assert.ok(scene.vertices.every(Number.isFinite));assert.ok(scene.groups.some(g=>g.demoActor?.name.startsWith('HM_coc')&&g.visible));}}
 assert.equal(sounds.filter(e=>e.node.play==='Play_sfx_head_struck_02').length,7);assert.equal(sounds.filter(e=>e.node.play==='Play_sfx_digiclock_tick_solo').length,60);
 assert.equal(messages.filter(([id,name])=>id==='gc_p05_010'&&name==='FinishMotion').length,1);
 assert.equal(host.players.get('gc_p01_070').state,'finished');assert.equal(host.players.get('gc_p05_010').state,'finished');assert.equal(host.players.get('gc_p04_310').state,'playing');
 host.stop('gc_p04_310');host.update(0);assert.ok(scene.groups.filter(g=>g.demoActor).every(g=>!g.visible));host.destroy();assert.equal(w._sequence_instance_count(),0);
});
