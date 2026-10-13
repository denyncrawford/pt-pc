import {test} from 'node:test';import assert from 'node:assert/strict';
import create from '../dist/geometry.js';import {loadHallway,withString} from '../runtime.js';import {prepareLocatorSounds} from '../audio.js';
test('original locator sounds follow script visibility, pause and release without restarting each frame',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true}),played=[],stopped=[];
 const audio={active:false,effect:(...args: any)=>played.push(args),releaseEffects:(key: any)=>stopped.push(key)};
 const host=await prepareLocatorSounds(w,scene,file,audio);assert.ok(host.items.length>2);
 host.update();assert.equal(played.length,0);audio.active=true;host.update();const count=played.length;host.update();assert.equal(played.length,count);
 withString(w,'f020',(p: any)=>w._script_set_floor(p));const exec=(name: any)=>assert.ok(withString(w,'pt14_hallway|pt14_hallway_demo|f020_demo|'+name,(p: any)=>w._script_exec_condition(p))>=0);
 exec('condition_enable_vfx_sd');host.update();assert.ok(played.some((e: any)=>e[1].play==='Play_sfx_head_struck_01'));const n=played.length;host.update();assert.equal(played.length,n);
 audio.active=false;exec('condition_disable_fxsd_sh_head_struck01_lobby');const before=stopped.length;host.update();assert.equal(stopped.length,before);audio.active=true;host.update();assert.ok(stopped.length>before);
 exec('condition_enable_demoScript');withString(w,'gc_p01_081',(d: any)=>withString(w,'FinishMotion',(m: any)=>w._script_demo_message(d,m)));host.update();assert.ok(played.some((e: any)=>/cry/.test(e[1].play)));
 assert.ok(played.every((e: any)=>e[2].every(Number.isFinite)&&e[3].forward.every(Number.isFinite)));host.destroy();const retired=stopped.length;host.destroy();host.update();assert.equal(stopped.length,retired);
 console.log('Locator inventory',host.unresolved.length,'visual resources; sounds:',[...new Set(played.map((e: any)=>e[1].play))]);
});

test('intro locator resources prepare without playing in a prefetched session',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),scene=await loadHallway(w,file,()=>{},{scripts:true,kind:'start'});let posted=0;const host=await prepareLocatorSounds(w,scene,file,{active:false,effect:()=>posted++,releaseEffects:()=>{}});host.update();assert.equal(posted,0);host.destroy();
});
