import {test} from 'node:test';
import assert from 'node:assert/strict';
import {primeStageAudio} from '../audio.js';
function fixture(){const calls=[];let resolve;return {calls,audio:{setVolume:(...v: any)=>calls.push(['volume',...v]),resume:()=>{calls.push(['resume']);return new Promise((r: any)=>resolve=r);},pause:async()=>calls.push(['pause'])},ready:()=>resolve()};}
test('destination is muted immediately before asynchronous start, current audio is untouched',async()=>{
 const f=fixture();let done=false;const p=primeStageAudio(f.audio,true,()=>true,()=>true).then((v: any)=>{done=v;});
 assert.deepEqual(f.calls,[['volume',0,true],['resume']]);assert.equal(done,false);f.ready();await p;assert.equal(done,true);assert.equal(f.calls.length,2);
});
test('cancellation while starting silences the candidate and refuses publication',async()=>{
 const f=fixture();let current=true;const p=primeStageAudio(f.audio,true,()=>current,()=>true);current=false;f.ready();assert.equal(await p,false);assert.deepEqual(f.calls.at(-1),['pause']);
});
test('pause during activation survives transfer; paused transfers do not start audio',async()=>{
 const f=fixture();let playing=true;const p=primeStageAudio(f.audio,true,()=>true,()=>playing);playing=false;f.ready();assert.equal(await p,true);assert.deepEqual(f.calls.at(-1),['pause']);
 const g=fixture();assert.equal(await primeStageAudio(g.audio,false,()=>true,()=>false),true);assert.deepEqual(g.calls,[['volume',0,true],['pause']]);
});
test('failed destination startup remains muted and propagates failure for retry',async()=>{
 let paused=0;const audio={setVolume(){},resume:async()=>{throw Error('start failed');},pause:async()=>paused++};await assert.rejects(primeStageAudio(audio,true,()=>true,()=>true),/start failed/);assert.equal(paused,1);
});
