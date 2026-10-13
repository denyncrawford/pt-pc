import {test} from 'node:test';
import assert from 'node:assert/strict';
import create from '../dist/geometry.js';
import {loadHallway} from '../runtime.js';
import {prepareDemoActors} from '../demo-actors.js';
import {auditStage} from '../tools/audit-stage.js';
import {SEQUENCE_FPS} from '../sequence-player.js';
test('f020 native bathroom and cockroach players preserve animation, events and lifetime',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true}),host=await prepareDemoActors(w,scene,file,['gc_p04_340','gc_p01_081']),sounds=[],messages=[];
 let time=0;host.audio={active:true,get time(){return time;},effect:(key: any,node: any,position: any)=>sounds.push({key,node,position}),releaseEffects:()=>{}};host.message=(id: any,name: any)=>messages.push([id,name]);
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 try{
 assert.equal(host.players.get('gc_p04_340').length,6198);
 for(const id of host.players.keys())host.play(id,identity);
 host.update(0);const initial=scene.vertices.slice();
 for(let frame=1;frame<=6200;frame++){time=frame/SEQUENCE_FPS;host.update(1/SEQUENCE_FPS);if(frame===30){assert.notDeepEqual(scene.vertices,initial);assert.ok(scene.vertices.every(Number.isFinite));assert.ok(scene.groups.some((g: any)=>g.demoActor?.name.startsWith('HM_coc')&&g.visible));}}
 assert.equal(host.players.get('gc_p01_081').state,'finished');assert.equal(host.players.get('gc_p04_340').state,'finished');
 assert.equal(host.unresolved.size,0);assert.equal(sounds.length,1);assert.ok(sounds[0].position.every(Number.isFinite));
 for(const id of host.players.keys())for(const message of ['FinishMotion','PlayEnd','Finish'])assert.equal(messages.filter(([i,m]: any)=>i===id&&m===message).length,1);
 console.log('f020 sound evidence',JSON.stringify(sounds));
 }finally{host.destroy();assert.equal(w._sequence_instance_count(),0);}
});
test('f020 inventory retains mandatory VFX enable/disable dependencies',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const a=await auditStage(await create(),Bun.file(process.env.PT_TEST_PSARC),'f020');assert.deepEqual(a.sequences.map((s: any)=>s.id).sort(),['gc_p01_081','gc_p04_340']);
 assert.ok(a.entities.some((e: any)=>e.properties.scriptFile?.some((s: any)=>s.endsWith('/trapEnableVfxData.lua'))));
 assert.ok(a.entities.some((e: any)=>e.properties.targetData?.some((s: any)=>s?.endsWith('3_FxLocator_fxsd_sh_ene_voice_cry_s01_bathroom'))));
});

test('f020 inventory exposes the two original locator resources required by scripts',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const a=await auditStage(await create(),Bun.file(process.env.PT_TEST_PSARC),'f020');const locators=a.entities.filter((e: any)=>e.class==='FxLocatorData');assert.equal(locators.length,2);assert.deepEqual(locators.map((e: any)=>e.properties.vfxFile[0]).sort(),['/Assets/sh/effect/vfx_data/sound/fxsd_sh_ene_voice_cry_f020.vfx','/Assets/sh/effect/vfx_data/sound/fxsd_sh_head_struck01.vfx']);
});
