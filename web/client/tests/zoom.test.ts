import {test} from 'node:test';import assert from 'node:assert/strict';import {PlayerZoom} from '../runtime.js';
test('standing zoom uses native 1.35 focal multiplier and releases smoothly',()=>{
 for(const hz of [60,120,300]){const z=new PlayerZoom(),base=z.fov();for(let i=0;i<hz;i++)z.update(1/hz,true);assert.equal(z.value,1.35);assert.ok(z.fov()<base);z.update(0,false);assert.equal(z.value,1.35);for(let i=0;i<hz;i++)z.update(1/hz,false);assert.equal(z.value,1);assert.equal(z.fov(),base);z.update(.01,true);z.reset();assert.equal(z.value,1);}
});
