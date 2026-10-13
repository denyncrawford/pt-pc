import {test} from 'node:test';import assert from 'node:assert/strict';
import create from '../dist/geometry.js';import {Psarc,parseFpk,fpkEntry} from '../archives.js';import {SequenceClock,SequencePlayer,SEQUENCE_FPS} from '../sequence-player.js';
test('concurrent original streams keep their tracks, clock, event cursors and ownership',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),a=await new Psarc(Bun.file(process.env.PT_TEST_PSARC)).open(),pkg=parseFpk(await a.read('as/sh/level/common/resident.fpk')),clock=new SequenceClock(),base=w._sequence_resident_bytes();
 const load=(id: any)=>{const path='/Assets/sh/demo/demo_stream/'+id+'.fsm';return new SequencePlayer(w,fpkEntry(pkg,path),id,clock);};
 for(let cycle=0;cycle<3;cycle++){
  const door=load('gc_p00_010'),roaches=load('gc_p04_310'),watch=load('gc_p05_010'),bath=load('gc_p01_070');
  assert.equal(w._sequence_instance_count(),4);assert.deepEqual([door.length,roaches.length,watch.length,bath.length],[128,5198,3597,598]);
  door.play();watch.play();roaches.play();clock.advance(1/SEQUENCE_FPS);
  const seen=[];for(const p of [door,watch,roaches])p.update((e: any)=>seen.push([p.name,e.index]));
  assert.ok(door.sample(0));const before=door.sample(0);
  assert.throws(()=>new SequencePlayer(w,new Uint8Array([0,1,2]),'invalid',clock));assert.equal(w._sequence_instance_count(),4);assert.deepEqual(door.sample(0),before);
  assert.equal(w._sequence_selected(),0);assert.throws(()=>watch.use(()=>{throw Error('handler');}),/handler/);assert.equal(w._sequence_selected(),0);
  const cursor=watch.cursor;clock.paused=true;clock.advance(5);watch.update(()=>assert.fail('paused clock dispatched an event'));assert.equal(watch.cursor,cursor);clock.paused=false;
  bath.play();clock.advance(1/SEQUENCE_FPS);assert.throws(()=>bath.update(()=>{throw Error('required effect');}),/required effect/);assert.equal(bath.cursor,0);bath.update(()=>{});assert.ok(bath.cursor>0);
  clock.advance(3);door.update(()=>{});watch.update(()=>{});assert.equal(door.state,'finished');assert.equal(watch.state,'playing');assert.ok(watch.frame>door.frame);
  const released=watch.handle;for(const p of [door,roaches,watch,bath]){p.destroy();p.destroy();}assert.equal(w._sequence_select(released),0);assert.equal(w._sequence_instance_count(),0);assert.equal(w._sequence_resident_bytes(),base);
 }
});
