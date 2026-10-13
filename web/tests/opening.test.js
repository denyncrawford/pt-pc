import test from 'node:test';import assert from 'node:assert/strict';
import create from '../dist/geometry.js';import {Psarc,parseFpk,fpkEntry} from '../archives.js';import {SequencePlayer,SequenceClock} from '../sequence-player.js';
test('original wake-up camera and player tracks decode with complete event inventory',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),a=await new Psarc(Bun.file(process.env.PT_TEST_PSARC)).open(),pkg=parseFpk(await a.read('as/sh/level/common/resident.fpk'));
 const name='/Assets/sh/demo/demo_stream/gc_p00_020.fsm',p=new SequencePlayer(w,fpkEntry(pkg,name),name,new SequenceClock());
 try{assert.equal(p.length,868);assert.equal(p.events.length,29);assert.ok(p.actors.some(a=>a.name==='demo_camera'));assert.ok(p.actors.some(a=>a.name==='HM_plr0_main0_def'));
 for(const frame of [1,200,522,866]){p.frame=frame;const sample=p.sample(p.actors.find(a=>a.name==='demo_camera').index);assert.ok(sample&&sample.every(Number.isFinite));}
 }finally{p.destroy();}assert.equal(w._sequence_instance_count(),0);
});
import {loadHallway} from '../runtime.js';
import {prepareOpening} from '../first-loop.js';
test('starting room: original camera roll, concurrent door, pause and grounded control handoff',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true,kind:'start'});
 assert.equal(scene.placements.length,7);assert.ok(scene.collisionCount>1000);assert.equal(scene.mirrorPlane,null);assert.ok(scene.lights.length&&scene.probes.length);
 const h=await prepareOpening(w,scene,file);let time=0,active=false;const effects=[];h.attachAudio({get active(){return active},get time(){return time},effect(...args){effects.push(args)},releaseEffects(){},async sequence(){}});
 try{const initial=h.update(0);assert.ok(Math.abs(initial.basis.up[0])>.5,'native rolled camera');assert.ok(initial.camera[1]<.2);h.update(10);assert.equal(h.frame,1,'paused audio must not advance opening');active=true;
 const roaches=[...new Set(scene.groups.filter(g=>g.demoActor?.player.name==='gc_p02_510').map(g=>g.demoActor))];assert.equal(roaches.length,2);
 let sampleA,sampleB;let end;for(let i=0;i<1500;i++){time+=1/60;const v=h.update(1/60);if(i===200){assert.ok(roaches.every(a=>a.created&&a.visible));sampleA=scene.vertices.slice(roaches[0].first*6,(roaches[0].first+roaches[0].count)*6);}if(i===400)sampleB=scene.vertices.slice(roaches[0].first*6,(roaches[0].first+roaches[0].count)*6);if(v?.transferred){end=v;break;}}
 assert.notDeepEqual(sampleA,sampleB,'original cockroach mesh animates');assert.ok(roaches.every(a=>!a.visible||!a.created),'roach actors retire');assert.ok(end);assert.equal(h.phase,'walking');assert.equal(h.completed,false,'presentation is not full stage completion');assert.ok(end.camera[1]>1.5);assert.ok(Math.abs(end.position[1])<.01);assert.ok(effects.length>0,'original door sound dispatched');
 const ocho=scene.placements.find(p=>p.name.endsWith('_ocho001_0000')),open=scene.placements.find(p=>p.name.endsWith('_door001_open_20'));assert.equal(w._scene_model_visible(ocho.modelIndex),0);assert.equal(w._scene_model_visible(open.modelIndex),1);
 }finally{h.destroy();}assert.equal(w._sequence_instance_count(),0);
});
import {openingHandoff} from '../first-loop.js';
test('native f000 exit prepares f010, animates door and transfers onto its floor',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const file=Bun.file(process.env.PT_TEST_PSARC),w=await create(),scene=await loadHallway(w,file,()=>{},{scripts:true,kind:'start'}),h=await prepareOpening(w,scene,file);let time=0,active=true,requests=0;const scheduled=[];
 await h.attachAudio({get active(){return active},get time(){return time},effect(){},releaseEffects(){},async sequence(events){scheduled.push(events.filter(e=>e.soundId).map(e=>e.frame));}});
 h.prepareDestination=async floor=>{assert.equal(floor,'f010');requests++;if(requests===1)throw Error('offline');};
 try{
  h.retryPreparation();await h.preparation;assert.match(h.blocking[0],/offline/);assert.equal(h.floor,'f000');
  for(let i=0;i<1500&&h.phase==='sequence';i++){time+=1/60;h.update(1/60);}
  assert.equal(h.phase,'walking');const before=scene.vertices.slice();
  let triggerPosition;for(let z=10.5;z<11.6;z+=.025){h.tick([0,0,z],Math.PI,[0,1]);triggerPosition=[0,0,z];}assert.equal(h.phase,'walking','failed destination must retain current stage');
  h.cameraPose={camera:[.2,1.65,11.3],yaw:Math.PI-.2,pitch:.1,fov:1};h.retryPreparation();await h.preparation;assert.equal(h.blocking.length,0);h.tick(triggerPosition,Math.PI,[0,1]);assert.equal(h.phase,'sequence','unacknowledged native trigger retries without leaving its volume');
  active=false;const frame=h.frame;h.update(1);assert.equal(h.frame,frame);active=true;
  let end;for(let i=0;i<260&&h.phase==='sequence';i++){time+=1/60;const v=h.update(1/60);if(i===0){assert.deepEqual(v.camera,h.cameraPose.camera,'first exit camera retains incoming player pose');assert.ok(Math.abs(v.fov-h.cameraPose.fov)<1e-6);}if(v?.exit)end=v;}
  assert.ok(end);assert.equal(h.phase,'handoff');assert.equal(h.completed,false);assert.notDeepEqual(before,scene.vertices);assert.deepEqual(scheduled.at(-1),[1,39,110,170]);
  const target=await create();await loadHallway(target,file,()=>{},{scripts:true,kind:'hallway'});let connector;
  for(let i=0;i<target._locator_count();i++)if(target.UTF8ToString(target._locator_name(i)).endsWith('|Connector_startDoor')){const p=target._locator_matrix(i)/4;connector=target.HEAPF32.slice(p,p+16);}
  const handoff=openingHandoff(end,connector,(...p)=>target._world_floor(...p));assert.ok(Math.abs(handoff.position[1]+1.4)<.01);assert.ok(handoff.position[2]>-6.1);assert.ok(handoff.camera.every(Number.isFinite));assert.throws(()=>openingHandoff(end,connector,()=>-100),/suelo/);
 }finally{h.destroy();}assert.equal(w._sequence_instance_count(),0);
});
