import {test} from 'node:test';import assert from 'node:assert/strict';import {StageCycle} from '../stage-cycle.js';
test('failed stage load preserves current resources and allows retry',async()=>{
 let released=0;const c=new StageCycle({floor:'f010',destroy:()=>released++});
 await assert.rejects(c.prepare('f005',async()=>{throw Error('range unavailable');}));
 assert.equal(c.current.floor,'f010');assert.equal(released,0);assert.equal(c.phase,'active');
 await c.prepare('f005',async floor=>({floor}));c.transfer(()=>{});
 assert.equal(c.current.floor,'f005');assert.equal(released,1);assert.equal(c.history.length,1);
});
test('failed transfer validation keeps both stages available for retry',async()=>{
 const c=new StageCycle({floor:'f010'});await c.prepare('f005',async floor=>({floor}));
 assert.throws(()=>c.transfer(()=>{throw Error('missing mandatory event');}));
 assert.equal(c.current.floor,'f010');assert.equal(c.phase,'ready');
 c.transfer(()=>{});assert.equal(c.current.floor,'f005');
});
test('unload cancels an in-flight stage and releases its eventual resources once',async()=>{
 let resolve,n=0;const c=new StageCycle({floor:'f010',destroy:()=>n++});const p=c.prepare('f005',()=>new Promise(r=>resolve=r));
 c.destroy();c.destroy();resolve({floor:'f005',destroy:()=>n++});assert.equal(await p,false);assert.equal(n,2);assert.equal(c.phase,'disposed');
});
test('unknown mandatory commands block progression with floor context',()=>{
 const c=new StageCycle({floor:'f005'});assert.throws(()=>c.fail('gc_p01_070 @89: VFX unsupported'),/f005: gc_p01_070 @89/);assert.equal(c.phase,'blocked');assert.equal(c.history.length,0);
});

test('cancelled malformed destination still releases the returned resource',async()=>{
 let resolve,released=0;const c=new StageCycle({floor:'f010'}),p=c.prepare('f005',()=>new Promise(r=>resolve=r));c.destroy();resolve({floor:'wrong',destroy:()=>released++});assert.equal(await p,false);assert.equal(released,1);
});
