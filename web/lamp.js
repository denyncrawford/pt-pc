import {Psarc,unwrap} from './archives.js';
import {withEntry,withString} from './runtime.js';
import {loadDemoResources} from './demo-resources.js';
import {transformPoint} from './first-loop.js';

// FloorLevel's lamp states. This selects a clip; ordinary hallway transfers do not restart it.
export function lampMotionForFloor(floor){
 if(['f100','f110'].includes(floor))return 'CeilLampStrong';
 return ['f005','f010','f020','f030','f040','f050','f060','f070','f120','f160'].includes(floor)?'CeilLamp':null;
}
export async function prepareLamp(w,scene,file,audio){
 const locator=w._lamp_locator();if(!locator)return null;
 const world=w.HEAPF32.slice(locator/4,locator/4+16),resources=await loadDemoResources(w,file),archive=await new Psarc(file).open();
 const setup=new TextDecoder().decode(unwrap(await archive.read('as/sh/level_asset/chara/gimmick/ShGimmickSetUp.lua')));
 const paths=new Map([...setup.matchAll(/Gimmick\.AddMotionPath\{\s*key\s*=\s*"([^"]+)"\s*,\s*path\s*=\s*"([^"]+)"/g)].map(m=>[m[1],m[2]]));
 const mtar='/Assets/sh/motion/mtar/gimmick/ShGimmick_layers.mtar',model='/Assets/sh/chara/lte/Scenes/lte0_main0_def.fmdl',clips=new Map();
 w._lamp_clear();
 try{
  withEntry(w,resources.read(mtar),mtar,(p,n)=>{if(!w._lamp_archive(p,n))throw Error('Animaciones originales de lámpara inválidas');});
  withEntry(w,resources.read(model),model,(p,n)=>{if(!w._lamp_model(p,n))throw Error('Esqueleto original de lámpara inválido');});
  for(const key of ['CeilLamp','CeilLampStrong']){
   const path=paths.get(key);if(!path)throw Error('Falta movimiento original '+key);
   const clip=withEntry(w,resources.read(mtar),mtar,(p,n)=>withString(w,path,k=>{const value=w._gimmick_audio_json(p,n,k);if(!value)throw Error('Movimiento inválido '+key);return JSON.parse(w.UTF8ToString(value));}));
   if(!withString(w,path,p=>w._lamp_motion(p)))throw Error('Rig de lámpara no soportado '+key);
   clip.path=path;clip.events=clip.events.map(e=>{
    if(e.args[0]!==6||e.args.length!==2)throw Error('Evento obligatorio de lámpara no soportado');
    if(!w._lamp_sample(e.frame))throw Error('Pose original de lámpara inválida');
    const bone=withString(w,e.bone,p=>w._lamp_bone(p));if(!bone)throw Error('Hueso sonoro original de lámpara ausente');
    const position=transformPoint(world,w.HEAPF32.slice(bone/4+12,bone/4+15));
    const sends=[];for(let i=0,n=w._acoustic_area(...position);i<n;i++)sends.push({bus:w.UTF8ToString(w._acoustic_bus(i)),level:w._acoustic_level(i)});
    return {...e,event:e.args[1]>>>0,position,sends};
   }).sort((a,b)=>a.frame-b.frame);clips.set(key,clip);
  }
  return new LampPlayer(clips,audio,(clip,frame)=>{withString(w,clip.path,p=>w._lamp_motion(p));if(!w._lamp_sample(frame))throw Error('No se pudo evaluar lámpara');},()=>w._lamp_clear());
 }catch(error){w._lamp_clear();throw error;}
}
export class LampPlayer {
 constructor(clips,audio,sample=()=>{},clear=()=>{}){this.clips=clips;this.audio=audio;this.sample=sample;this.clear=clear;this.motion=null;this.frame=0;this.lastTime=null;this.serial=0;this.destroyed=false;}
 suspend(){this.lastTime=null;}
 update(floor,paused=false){
  if(this.destroyed)return;
  if(paused||!this.audio.active){this.lastTime=null;return;}
  const now=this.audio.time,key=lampMotionForFloor(floor),changed=key!==this.motion;
  let from=this.frame,dt=this.lastTime===null?0:Math.max(0,now-this.lastTime);this.lastTime=now;
  if(changed){this.audio.releaseEffects('lamp:');this.motion=key;this.frame=0;from=-.001;dt=0;}
  if(!key)return;
  const clip=this.clips.get(key);if(!clip)throw Error('Movimiento original sin preparar: '+key);
  const to=this.frame+dt*clip.fps;
  const cues=[];
  for(const e of clip.events){const first=Math.max(0,Math.ceil((from-e.frame)/clip.frames)),last=clip.loop?Math.floor((to-e.frame)/clip.frames):0;
   for(let k=first;k<=last;k++){const at=e.frame+k*clip.frames;if(at>from&&at<=to)cues.push({e,at});}
  }
  cues.sort((a,b)=>a.at-b.at);
  for(const {e} of cues)this.audio.effect('lamp:'+this.serial++,{event:e.event,stopPlaying:true,fade:0,curve:4},e.position,{transient:true,sends:e.sends});
  this.frame=to;this.sample(clip,clip.loop?to%clip.frames:Math.min(to,clip.frames));
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.audio.releaseEffects('lamp:');this.clear();this.lastTime=null;}
}
