import createAudio from './audio-core.js';
const ascii=(w: any,s: any,fn: any)=>{if(!/^[\x20-\x7e]*$/.test(s))throw Error('Invalid audio identifier');const p=w._malloc(s.length+1);try{for(let i=0;i<s.length;i++)w.HEAPU8[p+i]=s.charCodeAt(i);w.HEAPU8[p+s.length]=0;return fn(p);}finally{w._free(p);}};
class OriginalAudio extends AudioWorkletProcessor {
declare seed: any;
declare bgm: any;
declare effects: any;
declare captions: any;
declare retired: any;
declare live: any;
declare playing: any;
declare w: any;
declare block: any;
declare port: any;

 constructor(options: any){super();this.seed=options.processorOptions.seed;this.bgm=new Set();this.effects=new Map();this.captions=new Map();this.retired=[];this.live=true;this.playing=false;this.w=null;this.block=0;this.port.onmessage=(e: any)=>this.command(e.data);createAudio({instantiateWasm:(imports: any,receive: any)=>{WebAssembly.instantiate(options.processorOptions.wasm,imports).then(({instance}: any)=>receive(instance)).catch((e: any)=>this.error(e));return {};}}).then((w: any)=>{this.w=w;w._audio_reset();this.port.postMessage({type:'ready'});}).catch((e: any)=>this.error(e));}
 error(e: any){this.playing=false;this.port.postMessage({type:'error',message:String(e?.message||e)});}
 command(m: any){try{const w=this.w;if(!w)throw Error('Audio core not ready');if(m.type==='load'||m.type==='subtitles'||m.type==='stream-load'){const b=new Uint8Array(m.bytes),p=w._malloc(b.length);try{w.HEAPU8.set(b,p);const ok=m.type==='stream-load'?ascii(w,m.name,(n: any)=>w._audio_stream_load(n,p,b.length)):m.type==='load'?ascii(w,m.name,(n: any)=>w._audio_load(n,p,b.length,m.package)):w._audio_subtitles(p,b.length);if(!ok)throw Error(w.UTF8ToString(w._audio_error()));}finally{w._free(p);}this.port.postMessage({type:'loaded',request:m.request});if(m.type==='subtitles')for(const [playing,c] of this.captions){const total=ascii(w,c.label,(p: any)=>w._audio_caption(p)),lines=[];for(let j=0;j<total;j++)lines.push({start:w._audio_caption_start(j),end:w._audio_caption_end(j),text:w.UTF8ToString(w._audio_caption_text(j))});this.port.postMessage({type:'notice',kind:0,playing,id:w.UTF8ToString(w._audio_caption_id()),time:c.time,lines});}}
 else if(m.type==='start'){if(!w._audio_start(this.seed))throw Error(w.UTF8ToString(w._audio_error()));this.playing=true;this.port.postMessage({type:'started',request:m.request});}
 else if(m.type==='stream-play'){if(!ascii(w,m.name,(p: any)=>w._audio_stream_play(p)))throw Error('Missing original demo audio '+m.name);}
 else if(m.type==='post'){if(m.bgm)this.bgm.add(m.name.replace(/^Stop_/, 'Play_'));const id=ascii(w,m.name,(p: any)=>w._audio_post(p,...m.position,m.spatial?1:0));if(!id)throw Error(w.UTF8ToString(w._audio_error()));}
 else if(m.type==='ambience'){const a=m.area;if(!ascii(w,a.event,(e: any)=>ascii(w,a.volume,(v: any)=>ascii(w,a.rtpc,(r: any)=>w._audio_ambience(e,v,r,a.value,a.rate)))))throw Error('Missing original ambience '+a.event);}
 else if(m.type==='sources'){for(const s of m.items)if(!ascii(w,s.name,(p: any)=>w._audio_source(s.index,p,...s.position,...s.forward,s.enabled?1:0,s.fade)))throw Error(w.UTF8ToString(w._audio_error()));}
 else if(m.type==='effect'){
  const old=this.effects.get(m.key);if(old){w._audio_effect_release(old.playing,old.object,old.node.fade,old.node.curve,old.node.stopPlaying?1:0);this.effects.delete(m.key);this.retired.push(old);}
  const used=new Set([...this.effects.values(),...this.retired].map((e: any)=>e.object));let object=16;while(used.has(object))object++;if(object>255)throw Error('Too many concurrent sound effects');
  const playing=m.node.event!==undefined?w._audio_effect_id(m.node.event,object,...m.position):ascii(w,m.node.play,(p: any)=>w._audio_effect(p,object,...m.position));if(!playing)throw Error('Missing original effect sound '+m.node.play);
  if(m.forward)w._audio_effect_transform(object,...m.position,...m.forward);
  if(m.sends)this.command({type:'acoustics',objects:[{object,sends:m.sends}]});
  this.effects.set(m.key,{playing,object,node:m.node,position:m.position,transient:!!m.transient,replayDelay:0});
 }
 else if(m.type==='effects-release'){for(const [key,e] of this.effects)if(key.startsWith(m.prefix)){if(!e.node.stopPlaying&&e.node.stop)ascii(w,e.node.stop,(p: any)=>w._audio_effect(p,e.object,...e.position));w._audio_effect_release(e.playing,e.object,e.node.fade,e.node.curve,e.node.stopPlaying?1:0);this.effects.delete(key);this.retired.push(e);}}
 else if(m.type==='acoustics'){
  for(const item of m.objects){const n=item.sends.length;if(n>16)throw Error('Too many acoustic sends');const p=w._malloc(n*8);try{const ids=new Uint32Array(w.HEAPU8.buffer,p,n);for(let i=0;i<n;i++)ids[i]=ascii(w,item.sends[i].bus,(b: any)=>w._audio_hash(b));for(let i=0;i<n;i++)w.HEAPF32[p/4+n+i]=item.sends[i].level;w._audio_sends(item.object,p,p+n*4,n);}finally{w._free(p);}w._audio_acoustic(item.object,item.obstruction||0,item.occlusion||0);}
 }
 else if(m.type==='footstep'){if(!w._audio_footstep(m.left?1:0,m.surface,...m.position))throw Error('Missing original footstep event');}
 else if(m.type==='listener')w._audio_listener(...m.position,...m.forward);
 else if(m.type==='sequence'){for(const e of m.events)if(!w._audio_schedule(e.id,e.seconds))throw Error('Missing original sequence sound '+e.id);this.port.postMessage({type:'sequence',audioTime:w._audio_time(),contextTime:currentTime,request:m.request});}
 else if(m.type==='stop')w._audio_stop();
 else if(m.type==='dispose'){w._audio_stop();this.playing=false;this.live=false;}
 }catch(e){this.error(e);}}
 process(inputs: any,outputs: any){const output=outputs[0];if(!this.playing||!this.w)return this.live;try{const w=this.w,n=output[0].length,p=w._audio_render(n)/4;if(!p)throw Error('Audio render failed');let peak=0;for(let i=0;i<n;i++){const l=w.HEAPF32[p+2*i],r=w.HEAPF32[p+2*i+1];output[0][i]=l;output[1][i]=r;peak=Math.max(peak,Math.abs(l),Math.abs(r));}
 for(const e of this.effects.values())if(e.node.play==='Play_sfx_water_drop_b'&&!w._audio_effect_alive(e.playing)){e.replayDelay-=n/48000;if(e.replayDelay<=0){e.playing=ascii(w,e.node.play,(p: any)=>w._audio_effect(p,e.object,...e.position));e.replayDelay=.8+Math.random();}}
 for(const [key,e] of this.effects)if(e.transient&&!w._audio_effect_alive(e.playing)){this.effects.delete(key);this.retired.push(e);}
 this.retired=this.retired.filter((e: any)=>!w._audio_effect_collect(e.playing,e.object));
 const count=w._audio_notifications();for(let i=0;i<count;i++){const kind=w._audio_notice_kind(i),playing=w._audio_notice_playing(i),label=w.UTF8ToString(w._audio_marker(i)),lines=[];if(kind===0){const total=ascii(w,label,(p: any)=>w._audio_caption(p));for(let j=0;j<total;j++)lines.push({start:w._audio_caption_start(j),end:w._audio_caption_end(j),text:w.UTF8ToString(w._audio_caption_text(j))});}if(kind===0&&lines.length)this.captions.set(playing,{label,time:currentTime});else if(kind===1)this.captions.delete(playing);this.port.postMessage({type:'notice',kind,playing,id:w.UTF8ToString(w._audio_caption_id()),time:currentTime,lines});}
 if(++this.block%94===0){this.port.postMessage({type:'meter',time:currentTime,peak});if(this.bgm.size)this.port.postMessage({type:'bgm',states:[...this.bgm].map((name: any)=>[name,ascii(w,name,(p: any)=>w._audio_event_playing(p))])});}
 }catch(e){this.error(e);}return this.live;}
}
registerProcessor('pt-original-audio',OriginalAudio);
