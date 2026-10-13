import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';import {loadHallway,stepPlayer} from '../runtime.js';import {prepareFirstLoop} from '../first-loop.js';import {prepareLocatorSounds} from '../audio.js';
test('walk original third loop f020 to its native destination',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),measurements=[];for(let cycle=0;cycle<3;cycle++){const started=performance.now(),scene=await loadHallway(w,file,()=>{},{scripts:true}),host=await prepareFirstLoop(w,scene,file);let time=0,sequenceBase=0;
 const sounds=[],commands=[];host.attachAudio({active:true,get time(){return time;},get sequenceSeconds(){return time-sequenceBase;},sequence:async()=>{sequenceBase=time;},command:(n,args)=>{commands.push([n,args]);return ['SoundPostEvent','VisibleControlSubtitle','CallBGM','StopBGM'].includes(n);},finish:()=>{},effect:(key,node)=>sounds.push(node.play),releaseEffects:()=>{}});
 const locators=await prepareLocatorSounds(w,scene,file,host.audio);
 w._player_spawn(...scene.spawn.position);
 function walk(x,z,ticks){for(let i=0;i<ticks;i++){const p=stepPlayer(w,x/300,z/300);if(i%10===0){time+=1/30;host.tick([...p].slice(0,3),Math.atan2(x,-z),[x,z]);host.update(1/30);locators.update();}if(host.phase==='sequence')return;}}
 async function exit(){assert.equal(host.phase,'sequence');let view;for(let i=0;i<135&&host.phase==='sequence';i++){time+=1/60;view=host.update(1/60);locators.update();}assert.ok(view.transferred);if(host.preparation)await host.preparation;return view;}
 try{
 walk(0,2,1890);walk(-2,0,3000);await exit();assert.equal(host.floor,'f005');
 host.tick([...stepPlayer(w,0,0)].slice(0,3),Math.PI,[0,1]);walk(0,2,1890);walk(-2,0,1200);
 assert.equal(host.ambient.players.get('gc_p04_310').state,'playing');
 walk(2,0,240);assert.equal(host.ambient.players.get('gc_p01_070').state,'playing');assert.equal(host.photoPrepared,true);
 for(let i=0;i<610;i++){time+=1/60;host.update(1/60);locators.update();}
 assert.equal(host.ambient.players.get('gc_p01_070').state,'finished');assert.equal(sounds.filter(n=>n==='Play_sfx_head_struck_02').length,7);
 // The authored f005 opening trigger is back in the first corridor, at z=2.05.
 const lobby=scene.placements.find(p=>p.name.endsWith('_lobby'));
 assert.equal(w._scene_model_visible(lobby.modelIndex),1);
 walk(-2,0,1500);assert.ok(stepPlayer(w,0,0)[0]>-11.5,'closed lobby blocks passage');
 walk(2,0,1650);walk(0,-2,825);
 assert.equal(w._scene_model_visible(lobby.modelIndex),0,'native return trigger opens lobby');
 walk(0,2,825);walk(-2,0,3000);assert.deepEqual(host.blocking,[]);assert.equal(host.ambient.players.get('gc_p04_310').state,'stopped');await exit();
 assert.ok(commands.some(([n,args])=>n==='SoundPostEvent'&&args[0]==='Set_rtpc_rainfall_s_direct'),'original floor script configures rain');assert.equal(host.floor,'f020');assert.equal(host.collectMenuPhoto(),true);assert.equal(host.collectMenuPhoto(),false);assert.equal(w._scene_photo_word(),0x104);assert.equal(host.completed,false);assert.equal(host.unsupported.size,0);assert.deepEqual(host.cycle.history,[{from:'f010',to:'f005'},{from:'f005',to:'f020'}]);
 host.tick([...stepPlayer(w,0,0)].slice(0,3),Math.PI,[0,1]);walk(0,2,1890);walk(-2,0,1200);walk(2,0,240);
 for(let i=0;i<120;i++){time+=1/60;host.update(1/60);locators.update();}
 assert.equal(host.ambient.players.get('gc_p01_081').state,'finished');assert.ok(sounds.includes('Play_sfx_head_struck_01'));assert.ok(sounds.includes('Play_voice_ene_cry_f020'));
 walk(-2,0,3000);await exit();assert.equal(host.ambient.players.get('gc_p04_340').state,'stopped');assert.ok(host.groups.filter(g=>g.demoActor?.player.name==='gc_p04_340').every(g=>!g.visible));assert.equal(host.floor,'f030');assert.equal(w._scene_photo_word(),0x104,'menu piece survives real stage transfer');assert.equal(host.completed,false);
 host.tick([...stepPlayer(w,0,0)].slice(0,3),Math.PI,[0,1]);walk(0,2,1890);walk(-2,0,1200);for(let i=0;i<360;i++){time+=1/60;host.update(1/60);locators.update();}
 assert.equal(host.ambient.players.get('gc_p01_011').state,'finished');walk(-2,0,1500);walk(2,0,900);for(let i=0;i<360;i++){time+=1/60;host.update(1/60);locators.update();}
 walk(2,0,1100);for(let i=0;i<180;i++){time+=1/60;host.update(1/60);locators.update();}
 assert.equal(host.ambient.players.get('gc_p01_020').state,'finished');assert.equal(host.ambient.players.get('gc_p03_010').state,'playing');assert.ok(commands.some(([name,args])=>name==='CallBGM'&&args[0]==='Play_bgm_unrest03'));assert.equal(host.unsupported.size,0);assert.equal(host.floor,'f030');
 }finally{locators.destroy();host.destroy();assert.equal(w._sequence_instance_count(),0);}
 measurements.push({cycle:cycle+1,elapsedMs:Math.round(performance.now()-started),sequenceBytes:w._sequence_resident_bytes(),liveBytes:w._sequence_live_heap_bytes(),wasmHeap:w.HEAPU8.buffer.byteLength});
 }assert.ok(measurements.every(m=>m.sequenceBytes===measurements[0].sequenceBytes));assert.ok(measurements[2].liveBytes<=measurements[0].liveBytes,'three third-loop runs release native allocations');console.log('Third-loop route: '+JSON.stringify(measurements));
});
