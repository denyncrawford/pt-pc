import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';import {auditStage} from '../tools/audit-stage.js';import {withString} from '../runtime.js';
test('f005 inventory preserves mandatory actors, effects and original trigger chain',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),a=await auditStage(w,Bun.file(process.env.PT_TEST_PSARC),'f005');
 const door=a.sequences.find(s=>s.id==='gc_p01_070'),actors=a.sequences.find(s=>s.id==='gc_p04_310');
 assert.equal(door.frames,598);assert.equal(actors.frames,5198);
 assert.deepEqual(actors.actors.filter(a=>a.kind===4).map(a=>a.name),['HM_coc0_main0_def1','HM_coc0_main0_def2']);
 assert.deepEqual(door.events.filter(e=>e.functor==='ba70c25c5ca2').map(e=>e.frame),[0,89,182,274,357,447,536]);
 const condition=a.entities.find(e=>e.name.endsWith('|condition_enable_data'));
 assert.ok(condition.properties.targetData.some(n=>n.endsWith('|3_trap_demo_gc_p01_070')));
 assert.equal(a.entities.find(e=>e.name.endsWith('|condition_demo_gc_p01_070')).properties.condition[0],'PhotoPrepare');
 assert.equal(withString(w,'f005',p=>w._script_set_floor(p)),1);assert.equal(w.UTF8ToString(w._script_next_floor()),'f020');
 assert.equal(withString(w,'f999',p=>w._script_set_floor(p)),0);assert.equal(w.UTF8ToString(w._script_next_floor()),'f020');
});
