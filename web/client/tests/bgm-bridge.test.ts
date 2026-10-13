import {test} from 'node:test';import assert from 'node:assert/strict';import create from '../dist/geometry.js';import {loadHallway,withEntry,withString} from '../runtime.js';
test('BGM script queries track play, stop and mixer completion',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create();await loadHallway(w,Bun.file(process.env.PT_TEST_PSARC),()=>{},{scripts:true});
 const lua=(text: any)=>assert.equal(withEntry(w,new TextEncoder().encode(text),'bgm-test.lua',(p: any,n: any)=>withString(w,'bgm-test.lua',(name: any)=>w._script_load(name,p,n))),1);
 lua(`assert(not GameSystem.IsPlayingBGM('Play_bgm_unrest03'))
 GameSystem.CallBGM('Play_bgm_unrest03')
 assert(GameSystem.IsPlayingBGM('Play_bgm_unrest03'))`);
 assert.equal(w.UTF8ToString(w._script_command_name(w._script_command_count()-1)),'CallBGM');
 withString(w,'Play_bgm_unrest03',(p: any)=>w._script_bgm_state(p,0));
 lua(`assert(not GameSystem.IsPlayingBGM('Play_bgm_unrest03'))
 GameSystem.CallBGM('Play_bgm_unrest03')
 GameSystem.StopBGM('Stop_bgm_unrest03')
 assert(not GameSystem.IsPlayingBGM('Play_bgm_unrest03'))`);
 assert.equal(w.UTF8ToString(w._script_command_name(w._script_command_count()-1)),'StopBGM');
});
