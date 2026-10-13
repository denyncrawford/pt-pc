import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';
import {Psarc,unwrap} from '../archives.js';import {withEntry,withString} from '../runtime.js';import {loadDemoResources} from '../demo-resources.js';
test('hanging lamp squeaks are original GANI cues, separate from electrical hum',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),a=await new Psarc(file).open(),r=await loadDemoResources(w,file);
 const setup=new TextDecoder().decode(unwrap(await a.read('as/sh/level_asset/chara/gimmick/ShGimmickSetUp.lua')));
 const paths=new Map([...setup.matchAll(/Gimmick\.AddMotionPath\{\s*key\s*=\s*"([^"]+)"\s*,\s*path\s*=\s*"([^"]+)"/g)].map((m: any)=>[m[1],m[2]]));
 const archive='/Assets/sh/motion/mtar/gimmick/ShGimmick_layers.mtar';
 for(const [key,frames,count] of [['CeilLamp',1119,8],['CeilLampStrong',440,4]]){
  assert.ok(paths.has(key));const clip=withEntry(w,r.read(archive),archive,(p: any,n: any)=>withString(w,paths.get(key),(k: any)=>JSON.parse(w.UTF8ToString(w._gimmick_audio_json(p,n,k)))));
  assert.equal(clip.frames,frames);assert.equal(clip.loop,true);assert.equal(clip.events.length,count);assert.ok(Math.abs(clip.fps-60000/1001)<.001);
  assert.ok(clip.events.every((e: any)=>e.args[0]===6&&e.frame>=0&&e.frame<clip.frames));console.log(key,JSON.stringify(clip));
 }
});
