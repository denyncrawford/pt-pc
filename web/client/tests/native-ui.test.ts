import {test} from 'node:test';import assert from 'node:assert/strict';
import create from '../dist/geometry.js';
import {loadNativeUi,NativeUiPlayers,sampleTrack,parseNativeUi,decodeMenuSounds} from '../native-ui.js';
const psarc=process.env.PT_TEST_PSARC,qar=process.env.PT_TEST_QAR;
test('original options load every UIF texture, linked UIA, FFNT glyph atlas and language from the library',{skip:!psarc||!qar},async()=>{
 const w=await create({wasmBinary:new Uint8Array(await Bun.file(new URL('../dist/geometry.wasm',import.meta.url)).arrayBuffer())});
 const r=await loadNativeUi(w,Bun.file(psarc),Bun.file(qar));
 assert.equal(r.model.nodes.length,79);assert.equal(r.textures.length,15);
 for(const t of r.textures)assert.equal(t.rgba.length,t.width*t.height*4);
 for(const id of [41,48,61,69,72,115,119,129,150])assert.ok(r.model.nodes.some((n: any)=>n.id===id));
 for(const n of r.model.nodes){assert.equal(n.rotation.length,4);assert.equal(n.color.length,4);assert.equal(n.size.length,2);assert.ok(n.parent<r.model.nodes.length);}
 for(const font of Object.values<any>(r.fonts)){assert.equal(font.pixels.length,font.width*font.height);assert.ok(font.glyphs.length>100);}
 assert.equal(r.languages.spa.op_brightness_setting,'Brillo');assert.equal(r.languages.eng.op_camera_normal,'Normal');
 const players=new NativeUiPlayers(r);players.play('UI_sys_opt_setin');players.play('UI_sys_opt_lp_1',true);players.play('UI_sys_opt_lp_2',true);assert.equal(players.players.filter((p: any)=>p.loop).length,2);
 players.play('UI_sys_option_bgrh_scle',false,0);const low=players.update(1).states;players.play('UI_sys_option_bgrh_scle',false,1);const high=players.update(0).states;assert.notDeepEqual([...low],[...high]);
 for(let i=0;i<30;i++){players.play('UI_sys_opt_camera_a_sel_'+(i%2+1));players.play('UI_sys_opt_subttl_sel_'+(i%8+1));}assert.ok(players.players.length<10,'covered animations must not accumulate');
 for(const a of r.animations.values())for(const node of a.nodes)for(const t of node.tracks){assert.equal(t.frames.length,t.values.length);assert.ok(t.values.every((v: any)=>v.length===4&&v.every(Number.isFinite)));}
 assert.throws(()=>parseNativeUi(w,new Uint8Array([1,2,3,4]),'bad.uif',0),/bad.uif/);
});
test('UIA sampling clamps endpoints and interpolates authored keys',()=>{const t={frames:[0,10,30],values:[[0,0,0,1],[10,2,4,.5],[20,4,8,0]]};assert.deepEqual(sampleTrack(t,-1),t.values[0]);assert.deepEqual(sampleTrack(t,40),t.values[2]);assert.deepEqual(sampleTrack(t,20),[15,3,6,.25]);});

test('menu cues decode from sys_resident with audible samples and terminate',{skip:!psarc},async()=>{
 const {default:audio}=await import('../dist/audio-core.js');const w=await audio();const sounds=await decodeMenuSounds(w,Bun.file(psarc));assert.equal(sounds.size,2);
 for(const pcm of sounds.values()){assert.ok(pcm.length>4800&&pcm.length<48000*10);assert.ok(pcm.every(Number.isFinite));assert.ok(pcm.some((v: any)=>Math.abs(v)>.01));}
});
