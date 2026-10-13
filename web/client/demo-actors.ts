import {SequenceClock,SequencePlayer} from './sequence-player.js';
import {loadDemoResources} from './demo-resources.js';
import {withEntry,withString} from './runtime.js';
import {readMaterials} from './materials.js';
import {readSkin} from './player-body.js';
import {multiply} from './lighting.js';
import {rotation,transformPoint} from './first-loop.js';
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export async function prepareDemoActors(w: any,scene: any,file: any,ids: any=['gc_p05_010','gc_p04_310','gc_p01_070']){
 const resources=await loadDemoResources(w,file),clock=new SequenceClock(),players=new Map(),actors=[],meshes=[];
 let nv=scene.vertices.length/6,ni=scene.indices.length;
 try{
 for(const id of ids){
  const meta=resources.metadata.get(id);if(!meta)throw Error('DemoData ausente: '+id);
  const player=new SequencePlayer(w,resources.read(meta.demoStreamPath),id,clock);players.set(id,player);player.models=new Map();player.origin=identity;
  for(const [name,path] of Object.entries<any>(meta.modelFiles)){
   const read=resources.entries.get(path)||scene.entries.get(path);if(!read)throw Error('Modelo de secuencia ausente: '+path);
   const skinned=player.actors.some((a: any)=>a.kind===5&&a.name===name);
   const mesh=withEntry(w,read(),path,(p: any,n: any)=>{try{
    if(w._decode_fmdl(p,n))throw Error('FMDL de secuencia inválido: '+path);
    const count=w._vertex_count(),bytes=w.HEAPU8.subarray(p,p+n),vertices=w.HEAPF32.slice(w._vertex_ptr()/4,w._vertex_ptr()/4+count*6),indices=w.HEAPU32.slice(w._index_ptr()/4,w._index_ptr()/4+w._index_count()),uvs=w.HEAPF32.slice(w._uv_ptr()/4,w._uv_ptr()/4+count*2);
    let skin;if(skinned){skin=readSkin(bytes,count);player.use(()=>withString(w,name,(np: any)=>{if(!w._sequence_bind_model(np,p,n))throw Error('Esqueleto de actor inválido');}));}
    return {vertices,indices,uvs,tangents:w.HEAPF32.slice(w._tangent_ptr()/4,w._tangent_ptr()/4+count*4),skin,groups:readMaterials(bytes)};
   }finally{w._release_geometry();}});
   const actor={name,code:resources.code(name),player,mesh,first:nv,count:mesh.vertices.length/6,created:false,visible:false,index:player.actors.find((a: any)=>a.name===name&&a.kind===(skinned?4:3))?.index};
   if(actor.index===undefined)throw Error('Actor sin pista: '+name);
   player.models.set(actor.code,actor);actors.push(actor);meshes.push(mesh);
   scene.groups.push(...mesh.groups.map((g: any)=>({...g,first:g.first+ni,demoActor:actor,visible:false})));
   nv+=actor.count;ni+=mesh.indices.length;
  }
 }
 const tangents=new Float32Array(nv*4);tangents.set(scene.tangents);const vertices=new Float32Array(nv*6),uvs=new Float32Array(nv*2),indices=new Uint32Array(ni);vertices.set(scene.vertices);uvs.set(scene.uvs);indices.set(scene.indices);
 let vi=scene.vertices.length/6,ii=scene.indices.length;for(const mesh of meshes){vertices.set(mesh.vertices,vi*6);tangents.set(mesh.tangents,vi*4);uvs.set(mesh.uvs,vi*2);indices.set(mesh.indices.map((i: any)=>i+vi),ii);vi+=mesh.vertices.length/6;ii+=mesh.indices.length;}
 scene.tangents=tangents;scene.vertices=vertices;scene.uvs=uvs;scene.indices=indices;
 }catch(e){for(const p of players.values())p.destroy();throw e;}
 let groups=scene.groups,lastAudioTime=null;
 const host={metadata:resources.metadata,players,clock,actors,unresolved:new Set(),dirty:false,audio:null,message:null,
  bindGroups(value: any){groups=value;},
  play(id: any,origin: any){const p=players.get(id);if(!p)return false;if(p.state==='playing')return true;p.origin=origin;p.finishSent=false;for(const a of p.models.values()){a.created=false;a.visible=false;}p.play();this.message?.(id,'Play');return true;},
  stop(id: any,{notify=true}: any={}){const p=players.get(id);if(!p)return false;if(p.state!=='playing')return true;p.stop();for(const a of p.models.values())a.visible=false;this.audio?.releaseEffects(id+':');if(notify)this.message?.(id,'Skip');return true;},
  update(dt: any){
   if(this.audio){if(!this.audio.active){lastAudioTime=null;return;}const now=this.audio.time;dt=lastAudioTime===null?0:Math.max(0,now-lastAudioTime);lastAudioTime=now;}
   clock.advance(dt);
   for(const p of players.values())if(p.state==='playing'){
    p.update((e: any)=>{
     const type=Number(e.type),arg=()=>BigInt.asUintN(64,w._sequence_event_arg(e.index,0)).toString(),actor=p.models.get(arg());
     if(type===0xc5806267){if(!actor)throw Error(`${p.name}: modelo sin resolver`);actor.created=true;actor.visible=true;}
     else if(type===0x75586ee7){if(actor){actor.created=false;actor.visible=false;}}
     else if(type===0x3e09e7b9){if(!actor)throw Error(`${p.name}: visibilidad sin modelo`);actor.visible=!!w._sequence_event_enabled(e.index);}
     else if(e.functor===0xba70c25c5ca2n){const effect=resources.effect(p.name,BigInt.asUintN(64,w._sequence_event_string(e.index,0xc5d7e215)));if(effect.nodes.some((n: any)=>!['FxModuleGraph','FxSoundCallProgramEffectNode'].includes(n))||!effect.sound)throw Error(`${p.name} @${e.frame}: efecto visual obligatorio ${effect.path}`);const pos=w._sequence_event_position(e.index)/4,position=transformPoint(p.origin,w.HEAPF32.slice(pos,pos+3)),instance=w._sequence_event_string(e.index,0xef98a387).toString();if(!this.audio)throw Error('Falta audio original para '+p.name);this.audio.effect(p.name+':'+instance,effect.sound,position);}
     else if(e.functor===0xcee2edd67199n){const code=BigInt.asUintN(64,w._sequence_event_string(e.index,0x73f3ece4)).toString(),name=['FinishMotion','Play','PlayEnd','Finish','Interrupt','Skip','Start'].find((n: any)=>resources.code(n)===code);if(!name)throw Error(`${p.name}: mensaje desconocido ${code}`);if(name==='FinishMotion'&&!p.finishSent){this.message?.(p.name,name);p.finishSent=true;}}
     // Native DemoSystem retains these three screen-state commands; its renderer
     // has no consumer for them. Keep them explicit as unresolved fidelity work.
     else if(p.name==='gc_p02_510'&&[0xd9ff1d14f050n,0xe9bab696f1fcn,0xc42eda2a5fbdn].includes(e.functor)){this.unresolved.add(p.name+':'+e.functor.toString(16));}
     else if(e.functor!==0n)throw Error(`${p.name} @${e.frame}: functor ${e.functor.toString(16)} obligatorio`);
     else if(![0xd3185dff,0x966d8ec3,0x3148f136,0x2a36c514,0xd2a6999a].includes(type))throw Error(`${p.name} @${e.frame}: evento ${type.toString(16)} obligatorio`);
    });
    for(const a of p.models.values())if(a.created){
     let palette;if(a.mesh.skin){p.use(()=>{const mp=w._malloc(64);try{w.HEAPF32.set(p.origin,mp/4);const count=withString(w,a.name,(np: any)=>w._sequence_model_skin(np,p.frame,mp));if(count<=a.mesh.skin.maxJoint)throw Error('Paleta de actor incompleta');const ptr=w._sequence_model_skin_ptr()/4;palette=w.HEAPF32.slice(ptr,ptr+count*16);}finally{w._free(mp);}});}
     else{const sample=p.sample(a.index);if(!sample)throw Error('Pista de actor sin muestra');const m=rotation(sample);m.set(sample.subarray(4,7),12);palette=multiply(p.origin,m);}
     const source=a.mesh.vertices,skin=a.mesh.skin,weights=skin&&new Float32Array(skin.packed),joints=skin&&new Uint32Array(skin.packed);
     for(let i=0;i<a.count;i++){let m=palette;if(skin){m=new Float32Array(16);for(let k=0;k<4;k++)for(let j=0;j<16;j++)m[j]+=weights[i*8+k]*palette[joints[i*8+k+4]*16+j];}const tangent=transformPoint(m,a.mesh.tangents.subarray(i*4,i*4+3),0);scene.tangents.set([...tangent,a.mesh.tangents[i*4+3]],(a.first+i)*4);const position=transformPoint(m,source.subarray(i*6,i*6+3)),normal=transformPoint(m,source.subarray(i*6+3,i*6+6),0),len=Math.hypot(...normal)||1;for(let k=0;k<6;k++){const value=Math.fround(k<3?position[k]:normal[k-3]/len),offset=(a.first+i)*6+k;if(scene.vertices[offset]!==value){scene.vertices[offset]=value;this.dirty=true;}}}
    }
    if(p.state==='finished'){if(!p.finishSent)this.message?.(p.name,'FinishMotion');this.message?.(p.name,'PlayEnd');this.message?.(p.name,'Finish');this.audio?.releaseEffects(p.name+':');}
   }
   for(const g of groups)if(g.demoActor){const visible=!g.stage&&g.demoActor.created&&g.demoActor.visible;if(g.visible!==visible){g.visible=visible;this.dirty=true;}}
  },
  destroy(){for(const p of players.values()){this.audio?.releaseEffects(p.name+':');p.destroy();}players.clear();}
 };
 return host;
}
