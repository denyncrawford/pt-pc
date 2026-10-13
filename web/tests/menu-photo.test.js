import {test} from 'node:test';
import assert from 'node:assert/strict';
import create from '../dist/geometry.js';
import {loadHallway} from '../runtime.js';
import {NativeMenu} from '../native-ui.js';

test('menu brightness updates do not restart unrelated selections',()=>{
 const calls=[],menu={options:{},players:{play:(...args)=>calls.push(args)}};
 const options={brightnessIndex:7,language:'spa',subtitles:true,invertX:false,invertY:false};
 NativeMenu.prototype.setOptions.call(menu,options);calls.length=0;
 NativeMenu.prototype.setOptions.call(menu,{...options,brightnessIndex:3});
 assert.deepEqual(calls,[['UI_sys_option_bgrh_scle',false,.3]]);
 const selected=[];menu.onAction=(a,v)=>selected.push([a,v]);
 for(const x of [-100,100,292,900])NativeMenu.prototype.action.call(menu,40,x,{x:100,w:384});
 assert.deepEqual(selected.map(s=>s[1]),[0,0,5,10]);
});

test('PhotoOption shares native puzzle bits and FrameOption visibility across floors',{skip:!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC);
 const scene=await loadHallway(w,file,()=>{},{scripts:true});
 const floor=name=>{const b=new TextEncoder().encode(name+'\0'),p=w._malloc(b.length);try{w.HEAPU8.set(b,p);assert.equal(w._script_set_floor(p),1);}finally{w._free(p);}};
 floor('f010');assert.equal(w._scene_photo_pending(),0);assert.equal(w._scene_photo_collect_option(),0);
 floor('f005');assert.ok(w._scene_photo_prepare()>0);assert.equal(w._scene_photo_word(),2);assert.equal(w._scene_photo_collect_option(),0);
 floor('f020');assert.equal(w._scene_photo_word(),4);assert.equal(w._scene_photo_pending(),1);
 const piece=scene.placements.find(p=>w.UTF8ToString(w._scene_model_nazo(p.modelIndex))==='FrameOption');assert.ok(piece,'original FrameOption asset');
 assert.equal(w._scene_model_visible(piece.modelIndex),0);
 assert.equal(w._scene_photo_collect_option(),1);assert.equal(w._scene_photo_word(),0x104);assert.equal(w._scene_model_visible(piece.modelIndex),1);
 assert.equal(w._scene_photo_collect_option(),0,'collection is idempotent');assert.equal(w._scene_photo_pending(),0);
 floor('f030');assert.equal(w._scene_photo_word(),0x104);assert.equal(w._scene_model_visible(piece.modelIndex),1);
 await loadHallway(w,file,()=>{},{scripts:true});assert.equal(w._scene_photo_word(),1,'new session resets collection');
});

test('PhotoOption waits for authored zoom completion and release, once per gesture',()=>{
 const animation={frames:60},calls=[];
 const menu={zoomStarted:true,zoomRelease:false,r:{animations:new Map([['/Assets/sh/ui/ModelAsset/sys_option/Scenes/UI_sys_opt_zoom_in.uia',animation]]),photo:{collect:()=>calls.push('collect')}},players:{players:[{animation,time:.2,speed:1}],play:name=>calls.push(name)}};
 const update=()=>NativeMenu.prototype.updatePhotoZoom.call(menu);
 update();assert.deepEqual(calls,[]);
 menu.zoomRelease=true;update();assert.deepEqual(calls,[],'short tap waits until zoom finishes');
 menu.players.players[0].time=1;update();assert.deepEqual(calls,['UI_sys_opt_zoom_out','collect']);update();assert.equal(calls.length,2);
 menu.zoomRelease=true;menu.zoomStarted=false;update();assert.equal(calls.length,2,'cancelled gesture never collects');
});
