// Native menu resources: no embedded game assets or browser-font replacement.
import {Psarc,parseFpk,fpkEntry} from './archives.js';
import {withEntry} from './runtime.js';
import {Qar,parsePftxs,loadFtex} from './materials.js';
export function parseNativeUi(w: any,bytes: any,path: any,kind: any){return withEntry(w,bytes,path,(p: any,n: any)=>{const value=JSON.parse(w.UTF8ToString(w._ui_read(p,n,kind)));if(value.error)throw Error(path+': '+value.error);return value;});}
export async function loadNativeUi(w: any,file: any,textureFile: any){
 const archive=await new Psarc(file).open(),entries=new Map(),packed=new Map();
 for(const name of archive.names.keys())if(/\/ui\/ui_default_(data|lang)\.fpkd?$/.test(name)){const pkg=parseFpk(await archive.read(name));for(const e of pkg.entries)entries.set(e.name,fpkEntry(pkg,e.name));}
 for(const name of archive.names.keys())if(/\/ui\/ui_default_(data|lang)\.pftxs$/.test(name))for(const [p,b]of parsePftxs(await archive.read(name)))packed.set(p,b);
 const find=(s: any)=>{const path=[...entries.keys()].find((p: any)=>p.endsWith(s));if(!path)throw Error('Falta recurso del menú: '+s);return path;};
 const read=(s: any,k: any)=>{const p=find(s);return parseNativeUi(w,entries.get(p),p,k);};
 const model=read('/UI_sys_option.uif',0),layout=read('/UI_sys_option.uilb',2),animations=new Map();
 for(const a of layout.animations)for(const path of [a.main,a.shader])if(path&&!animations.has(path)){const bytes=entries.get(path);if(!bytes)throw Error('Falta animación: '+path);animations.set(path,parseNativeUi(w,bytes,path,1));}
 const languages: Record<string, any>={};for(const code of ['eng','fra','deu','spa','jpn','ita','por'])languages[code]=read('/OPTIONS.lng#'+code,3);
 const fonts: Record<string, any>={};for(const name of ['font_def_ltn','font_def_jp']){const path='as/sh/font/'+name+'.ffnt';const f=parseNativeUi(w,await archive.read(path),path,4);f.pixels=w.HEAPU8.slice(w._ui_atlas(),w._ui_atlas()+w._ui_atlas_size());fonts[name]=f;}
 const qar=await new Qar(textureFile,w).open(),source={read:(name: any)=>packed.has(name)?packed.get(name):qar.read(name)},textures=[];
 for(const path of model.textures)textures.push(await loadFtex(source,path.replace(/\.ftex$/,''),Infinity,{strict:true}));
 const styles=read('/common_art.fox2',5);return {model,layout,animations,languages,fonts,textures,styles};
}
export function sampleTrack(track: any,frame: any){const fs=track.frames,vs=track.values;if(!vs.length)return [0,0,0,0];if(frame<=fs[0])return vs[0];let hi=fs.findIndex((f: any)=>f>frame);if(hi<0)return vs.at(-1);const t=(frame-fs[hi-1])/(fs[hi]-fs[hi-1]);return vs[hi-1].map((v: any,i: any)=>v+(vs[hi][i]-v)*t);}
export class NativeUiPlayers{
declare resources: any;
declare players: any;

 constructor(resources: any){this.resources=resources;this.players=[];}
 play(name: any,loop: any=false,hold: any=null){for(const a of this.resources.layout.animations)if(a.main.split('/').pop()===name+'.uia'||(!a.main&&a.shader.split('/').pop().replace(/_s\.uia$/,'.uia')===name+'.uia'))for(const path of[a.main,a.shader]){const animation=this.resources.animations.get(path);if(!animation)continue;const channels=new Set(animation.nodes.flatMap((n: any)=>n.tracks.map((t: any)=>n.hash+':'+t.unit)));this.players=this.players.filter((p: any)=>p.animation!==animation&&!p.animation.nodes.every((n: any)=>n.tracks.every((t: any)=>channels.has(n.hash+':'+t.unit))));this.players.push({animation,time:0,speed:a.speed,loop,hold});}}
 update(dt: any){const states=new Map(),points=new Map();for(const p of this.players){p.time+=dt;let f=p.hold===null?p.time*60*p.speed:p.hold*p.animation.frames;f=p.loop&&p.animation.frames?f%p.animation.frames:Math.min(f,p.animation.frames);for(const n of p.animation.nodes){const s=states.get(n.hash)||{};for(const t of n.tracks){const v=sampleTrack(t,f);if(t.unit===0xa34aedba){s.translate=v;points.set(n.hash,v);}else if(t.unit===0x8550fcee)s.scale=v;else if(t.unit===0x6318d107)s.color=v;else if(t.slot>=0)(s.params??={})[t.slot]=v[0];}states.set(n.hash,s);}}return {states,points};}
}
const shader=`
struct Params { m:array<vec4f,7>, screen:vec4f, text:vec4f };
@group(0) @binding(0) var s:sampler;
@group(0) @binding(1) var t0:texture_2d<f32>;
@group(0) @binding(2) var t1:texture_2d<f32>;
@group(0) @binding(3) var t2:texture_2d<f32>;
@group(0) @binding(4) var t3:texture_2d<f32>;
@group(0) @binding(5) var<uniform> p:Params;
struct Out { @builtin(position) pos:vec4f, @location(0) uv:vec2f, @location(1) color:vec4f };
@vertex fn vs(@location(0) xy:vec2f,@location(1) uv:vec2f,@location(2) color:vec4f)->Out {var o:Out;o.pos=vec4f(xy,0,1);o.uv=uv;o.color=color;return o;}
@fragment fn fs(o:Out)->@location(0) vec4f {
 if(p.text.x>0.5){return vec4f(o.color.rgb,o.color.a*textureSample(t0,s,o.uv).r);}
 let m=p.m;let uv=o.uv;
 let base=textureSample(t0,s,(uv-m[0].xy)*m[1].xy+m[0].xy+m[0].zw);
 let layer=textureSample(t1,s,(uv-m[1].zw)*m[2].zw+m[1].zw+m[2].xy);
 let mask=textureSample(t2,s,(uv-m[3].xy)*m[4].xy+m[3].xy+m[3].zw);
 let screen=(o.pos.xy-p.screen.xy)*p.screen.z;
 let noise=textureSample(t3,s,(screen-m[4].zw)*m[5].zw+m[4].zw+m[5].xy);
 let rgb=clamp(mix(base.rgb,layer.rgb,m[6].y),vec3f(0),vec3f(1))*o.color.rgb;
 let a=clamp(mix(base.a,layer.a,m[6].y),0.,1.)*(m[6].z*(mask.g-1.)+1.);
 return vec4f(rgb,clamp(a*(m[6].w*(noise.g-1.)+1.),0.,1.)*o.color.a);
}`;
const textKeys={150:'op_options',115:'op_back',41:'op_brightness_setting',48:'op_britness_tip',119:'op_subtitles_setting',78:'op_camera_setting',93:'op_camera_y_axis',88:'op_camera_normal',86:'op_camera_reversed',108:'op_camera_x_axis',103:'op_camera_normal',101:'op_camera_reversed'};
for(const [i,key]of ['none','english','french','german','spanish','japanese','itlian','portuguese'].entries())textKeys[121+i*2]='op_sub_'+key;
const languageCodes=['eng','fra','deu','spa','jpn','ita','por'];
const mul=(a: any,b: any)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const xy=(m: any,v: any)=>[m[0]*v[0]+m[2]*v[1]+m[4],m[1]*v[0]+m[3]*v[1]+m[5]];
export class NativeMenu {
declare device: any;
declare canvas: any;
declare r: any;
declare onAction: any;
declare options: any;
declare players: any;
declare owned: any;
declare hit: any;
declare active: any;
declare format: any;
declare context: any;
declare pipelines: any;
declare composite: any;
declare outputSettings: any;
declare sampler: any;
declare white: any;
declare textures: any;
declare fonts: any;
declare draws: any;
declare cleanBindings: any;
declare vertices: any;
declare pointerPosition: any;
declare dragDown: any;
declare drag: any;
declare dragMove: any;
declare dragEnd: any;
declare click: any;
declare key: any;
declare language: any;
declare zoomStarted: any;
declare keyup: any;
declare zoomRelease: any;
declare zoomDown: any;
declare zoomUp: any;
declare contextMenu: any;
declare soundContext: any;
declare soundGain: any;
declare soundBuffers: any;
declare onAudioError: any;
declare last: any;
declare frame: any;
declare closing: any;
declare target: any;
declare outputBinding: any;

 constructor(device: any,canvas: any,resources: any,onAction: any){this.device=device;this.canvas=canvas;this.r=resources;this.onAction=(action: any,value: any)=>{if(action==='brightness'&&value===this.options.brightnessIndex)return;this.sound(action==='web'?'Play_sys_change_01':'Play_sys_cursor_01');onAction(action,value);};this.players=new NativeUiPlayers(resources);this.owned=[];this.hit=[];this.active=false;this.options={};
  // Like the native PC extension, derive additional text nodes from the authored Back label.
  const base=resources.model.nodes.find((n: any)=>n.id===115),root=resources.model.nodes.findIndex((n: any)=>n.id===1);
  for(const [id,label,pos,size]of [[10000,'Configuración web',[32,-26],20],[10001,'Salir',[-12,-26],20],[10002,'by denyncrawford and LoreanXavier',[22,-34],12]] as [number,string,number[],number][])resources.model.nodes.push({...structuredClone(base),id,hash:id,parent:root,fontHash:size===12?1769481682:3485171249,translate:[...pos,0,1],label});

  const format=navigator.gpu.getPreferredCanvasFormat();this.format=format;this.context=canvas.getContext('webgpu');this.context.configure({device,format,alphaMode:'opaque'});
  const module=device.createShaderModule({code:shader});this.pipelines=[false,true].map((add: any)=>device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:add?'one':'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:add?'one':'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}}));
  const composite=device.createShaderModule({code:`
 @group(0) @binding(0) var image:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> settings:vec4f;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {let c=textureLoad(image,vec2i(pos.xy),0).rgb;return vec4f(pow(clamp(c,vec3f(0),vec3f(1)),vec3f(1./settings.x)),1);}`});
  this.composite=device.createRenderPipeline({layout:'auto',vertex:{module:composite,entryPoint:'vs'},fragment:{module:composite,entryPoint:'fs',targets:[{format}]}});
  this.outputSettings=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.owned.push(this.outputSettings);
  this.sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
  const tex=(width: any,height: any,data: any,format: any='rgba8unorm')=>{const t=device.createTexture({size:[width,height],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture:t},data,{bytesPerRow:width*(format==='r8unorm'?1:4)},[width,height]);this.owned.push(t);return t.createView();};
  this.white=tex(1,1,new Uint8Array([255,255,255,255]));this.textures=resources.textures.map((t: any)=>tex(t.width,t.height,t.rgba));this.fonts={};for(const [name,f]of Object.entries<any>(resources.fonts))this.fonts[name]={...f,view:tex(f.width,f.height,f.pixels,'r8unorm'),map:new Map(f.glyphs.map((g: any)=>[g[0],g]))};
  this.draws=resources.model.nodes.map((n: any)=>{const buffer=device.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.owned.push(buffer);const views=n.textures.map((i: any)=>this.textures[i]||this.white);const binding=(pipeline: any,ts: any)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.sampler},...ts.map((resource: any,i: any)=>({binding:i+1,resource})),{binding:5,resource:{buffer}}]});return{buffer,binding,bindings:this.pipelines.map((p: any)=>binding(p,views)),fontBindings:Object.fromEntries(Object.entries<any>(this.fonts).map(([k,f]: any)=>[k,this.pipelines.map((p: any)=>binding(p,[f.view,this.white,this.white,this.white]))]))};});
  const clean=resources.model.nodes.find((n: any)=>n.id===69).textures.map((i: any)=>this.textures[i]||this.white),left=this.draws[resources.model.nodes.findIndex((n: any)=>n.id===61)];this.cleanBindings=this.pipelines.map((p: any)=>left.binding(p,clean));
  this.vertices=device.createBuffer({size:4*1024*1024,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.owned.push(this.vertices);
  this.pointerPosition=(e: any)=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};};
  this.dragDown=(e: any)=>{if(!this.active||e.button!==0)return;const {x,y}=this.pointerPosition(e),h=this.hit.find((h: any)=>h.id===40&&x>=h.x-8&&x<=h.x+h.w+8&&y>=h.y&&y<=h.y+h.h);if(!h)return;e.preventDefault();canvas.focus();this.drag={id:e.pointerId,h};canvas.setPointerCapture(e.pointerId);this.action(40,x,h);};this.dragMove=(e: any)=>{if(this.drag?.id===e.pointerId)this.action(40,this.pointerPosition(e).x,this.drag.h);};this.dragEnd=(e: any)=>{if(this.drag?.id!==e.pointerId)return;this.drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};canvas.addEventListener('pointerdown',this.dragDown);canvas.addEventListener('pointermove',this.dragMove);canvas.addEventListener('pointerup',this.dragEnd);canvas.addEventListener('pointercancel',this.dragEnd);canvas.style.touchAction='none';
  this.click=(e: any)=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.width/rect.width,y=(e.clientY-rect.top)*canvas.height/rect.height;const h=this.hit.find((h: any)=>x>=h.x&&y>=h.y&&x<=h.x+h.w&&y<=h.y+h.h);if(h)this.action(h.id,x,h);};canvas.addEventListener('click',this.click);
  this.key=(e: any)=>{if(!this.active)return;if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();this.onAction('brightness',Math.max(0,Math.min(10,(this.options.brightnessIndex??7)+(e.code==='ArrowRight'?1:-1))));}if(e.code==='ArrowUp'||e.code==='ArrowDown'){e.preventDefault();const current=this.options.subtitles?languageCodes.indexOf(this.language)+1:0,index=(current+(e.code==='ArrowDown'?1:7))%8;this.onAction('language',index?languageCodes[index-1]:null);}if(e.code==='KeyY')this.onAction('invertY',!this.options.invertY);if(e.code==='KeyX')this.onAction('invertX',!this.options.invertX);if(e.code==='Enter')this.onAction('web');if(e.code==='KeyZ'&&!e.repeat){this.zoomStarted=true;this.players.play('UI_sys_opt_zoom_in');}};this.keyup=(e: any)=>{if(this.active&&e.code==='KeyZ')this.zoomRelease=true;};canvas.addEventListener('keydown',this.key);canvas.addEventListener('keyup',this.keyup);this.zoomDown=(e: any)=>{if(e.button===2){e.preventDefault();canvas.focus();{this.zoomStarted=true;this.players.play('UI_sys_opt_zoom_in');}}};this.zoomUp=(e: any)=>{if(e.button===2)this.zoomRelease=true;};this.contextMenu=(e: any)=>e.preventDefault();canvas.addEventListener('pointerdown',this.zoomDown);canvas.addEventListener('pointerup',this.zoomUp);canvas.addEventListener('contextmenu',this.contextMenu);
 }
 sound(name: any){if(!this.r.sounds?.has(name))return;if(!this.soundContext){this.soundContext=new AudioContext({sampleRate:48000});this.soundGain=this.soundContext.createGain();this.soundGain.connect(this.soundContext.destination);this.soundBuffers=new Map();for(const [key,pcm]of this.r.sounds){const buffer=this.soundContext.createBuffer(2,pcm.length/2,48000);for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let i=0;i<channel.length;i++)channel[i]=pcm[i*2+c];}this.soundBuffers.set(key,buffer);}}this.soundGain.gain.value=this.options.volume??1;this.soundContext.resume().then(()=>{if(this.soundContext.state==='closed')return;const source=this.soundContext.createBufferSource();source.buffer=this.soundBuffers.get(name);source.connect(this.soundGain);source.onended=()=>source.disconnect();source.start();}).catch((e: any)=>this.onAudioError?.(e));}
 action(id: any,x: any,h: any){if(id===10000)this.onAction('web');else if(id===10001)this.onAction('exit');else if(id===115)this.onAction('back');else if(id===40)this.onAction('brightness',Math.max(0,Math.min(10,Math.round((x-h.x)/h.w*10))));else if(id>=121&&id<=135){const i=(id-121)/2;this.onAction('language',i?languageCodes[i-1]:null);}else if([88,86].includes(id))this.onAction('invertY',id===86);else if([103,101].includes(id))this.onAction('invertX',id===101);}
 setOptions(options: any){const old=this.options;this.options=options;const lang=options.language?.toLowerCase()||'spa';this.language=languageCodes.includes(lang)?lang:'eng';this.players.play('UI_sys_option_bgrh_scle',false,(options.brightnessIndex??7)/10);if(old.invertY!==options.invertY)this.players.play('UI_sys_opt_camera_a_sel_'+(options.invertY?2:1));if(old.invertX!==options.invertX)this.players.play('UI_sys_opt_camera_b_sel_'+(options.invertX?2:1));if(old.language!==options.language||old.subtitles!==options.subtitles)this.players.play('UI_sys_opt_subttl_sel_'+(options.subtitles?languageCodes.indexOf(this.language)+2:1));}
 open(options: any){this.options={};this.zoomRelease=false;this.zoomStarted=false;this.players.players=[];this.players.play('UI_sys_opt_setin');this.players.play('UI_sys_opt_lp_1',true);this.players.play('UI_sys_opt_lp_2',true);this.setOptions(options);if(this.active)return;this.active=true;this.last=performance.now();const tick=(now: any)=>{if(!this.active)return;this.draw(Math.min(.1,(now-this.last)/1000));this.last=now;this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);this.canvas.focus();}
 fadeOut(){if(!this.active)return Promise.resolve();if(this.closing)return this.closing.promise;this.players.play('UI_sys_opt_setout');let resolve;const promise=new Promise((r: any)=>resolve=r);this.closing={promise,resolve};return promise;}
 close(){this.drag=null;this.zoomStarted=false;this.zoomRelease=false;this.closing?.resolve();this.closing=null;this.active=false;cancelAnimationFrame(this.frame);}
 destroy(){this.close();for(const [name,fn]of [['pointerdown',this.dragDown],['pointermove',this.dragMove],['pointerup',this.dragEnd],['pointercancel',this.dragEnd]])this.canvas.removeEventListener(name,fn);this.canvas.removeEventListener('click',this.click);this.canvas.removeEventListener('keydown',this.key);this.canvas.removeEventListener('keyup',this.keyup);this.canvas.removeEventListener('pointerdown',this.zoomDown);this.canvas.removeEventListener('pointerup',this.zoomUp);this.canvas.removeEventListener('contextmenu',this.contextMenu);this.soundContext?.close();this.soundBuffers?.clear();this.target?.destroy();for(const resource of this.owned)resource.destroy();this.context.unconfigure();}
 updatePhotoZoom(){if(this.zoomRelease&&this.zoomStarted&&!this.players.players.some((p: any)=>p.animation===this.r.animations.get('/Assets/sh/ui/ModelAsset/sys_option/Scenes/UI_sys_opt_zoom_in.uia')&&p.time*60*p.speed<p.animation.frames)){this.players.play('UI_sys_opt_zoom_out');this.zoomRelease=false;this.zoomStarted=false;this.r.photo?.collect();}}
 draw(dt: any){
  const {canvas,device,r}=this;const width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio)),height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  if(!this.target||this.target.width!==width||this.target.height!==height){this.target?.destroy();this.target=device.createTexture({size:[width,height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.outputBinding=device.createBindGroup({layout:this.composite.getBindGroupLayout(0),entries:[{binding:0,resource:this.target.createView()},{binding:1,resource:{buffer:this.outputSettings}}]});}
  device.queue.writeBuffer(this.outputSettings,0,new Float32Array([this.options.brightness||1,0,0,0]));
  const fit=Math.min(width/1280,height/720),ox=(width-1280*fit)/2,oy=(height-720*fit)/2,point=(p: any)=>[ox+(640+p[0]*10)*fit,oy+(360-p[1]*10)*fit];
  this.updatePhotoZoom();
  const {states,points}=this.players.update(dt),worlds=[],nodes=r.model.nodes;const resolve=(i: any)=>{if(worlds[i])return worlds[i];const n=nodes[i],s=states.get(n.hash)||{},parent=n.parent>=0?resolve(n.parent):{m:[1,0,0,1,0,0],c:[1,1,1,1]};const t=s.translate||n.translate,sc=s.scale||n.scale,a=2*Math.atan2(n.rotation[2],n.rotation[3]),c=Math.cos(a),sn=Math.sin(a);let color=n.color.map((v: any,k: any)=>v*(s.color?(k===3?1:s.color[k]):1));if(s.color)color[3]=s.color[3];if([61,69].includes(n.id))color=color.map((v: any,k: any)=>v*(k===3?1:.09));if(n.id===72)color=color.map((v: any,k: any)=>v*(k===3?1:.01));return worlds[i]={m:mul(parent.m,[c*sc[0],sn*sc[0],-sn*sc[1],c*sc[1],t[0],t[1]]),c:color.map((v: any,k: any)=>v*parent.c[k])};};
  let data=[];const commands=[];this.hit=[];const add=(p: any,uv: any,c: any)=>data.push(p[0]/width*2-1,1-p[1]/height*2,...uv,...c);const rect=(x: any,y: any,w: any,h: any,u: any,v: any,uw: any,vh: any,c: any)=>{for(const [a,b]of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]])add([x+w*a,y+h*b],[u+uw*a,v+vh*b],c);};
  for(const [i,n]of nodes.map((n: any,i: any)=>[i,n]).sort((a: any,b: any)=>a[1].priority-b[1].priority)){
   if(n.type<2)continue;const world=resolve(i),s=states.get(n.hash)||{},mat=states.get(n.materialHash)||{},draw=this.draws[i],start=data.length/8;let fontKey=null;
   if(n.type===2){let positions=n.positions.map((p: any)=>p.slice());for(const p of n.points){const target=points.get(p.hash);if(target)for(const vi of p.vertices)positions[vi]=positions[vi].map((v: any,k: any)=>v+target[k]-p.position[k]);}for(const index of n.indices){if(!positions[index]||!n.uvs[index])continue;add(point(xy(world.m,positions[index].map((v: any,k: any)=>v*n.size[k]))),n.uvs[index],world.c);}}
   else if(textKeys[n.id]||n.label){
    const text=n.label||r.languages[this.language][textKeys[n.id]]||r.languages.eng[textKeys[n.id]]||'';fontKey=this.language==='jpn'?'font_def_jp':'font_def_ltn';const font=this.fonts[fontKey],scale=Math.sqrt(Math.abs(world.m[0]*world.m[3]-world.m[1]*world.m[2]));
    const style=r.styles?.find((s: any)=>s.hash===n.fontHash&&s.language.toLowerCase()===this.language)||r.styles?.find((s: any)=>s.hash===n.fontHash);const fw=(style?.fontWidth||20)*scale*fit,fh=(style?.fontHeight||20)*scale*fit,space=(style?.textSpace||0)*scale*fit;
    const a=point(xy(world.m,n.boxMin.slice(0,2).map((v: any,k: any)=>v*n.size[k]))),b=point(xy(world.m,n.boxMax.slice(0,2).map((v: any,k: any)=>v*n.size[k]))),lo=[Math.min(a[0],b[0]),Math.min(a[1],b[1])],hi=[Math.max(a[0],b[0]),Math.max(a[1],b[1])];const lines=[];let line=[],length=0;
    for(const char of text.replace(/\r/g,'')){const g=font.map.get(char.codePointAt(0))||font.map.get(63),advance=(g?g[5]*fw:0)+space;if(char==='\n'||(hi[0]>lo[0]&&length+advance>hi[0]-lo[0]&&line.length)){const spaceAt=char==='\n'?-1:line.findLastIndex((p: any)=>p.char===' ');if(spaceAt>=0){const rest=line.slice(spaceAt+1);line=line.slice(0,spaceAt);lines.push({line,length:line.reduce((sum: any,p: any)=>sum+(p.g?p.g[5]*fw:0)+space,0)});line=rest;length=rest.reduce((sum: any,p: any)=>sum+(p.g?p.g[5]*fw:0)+space,0);}else{lines.push({line,length});line=[];length=0;}if(char==='\n')continue;}line.push({g,char});length+=advance;}lines.push({line,length});const lineHeight=fh*(font.em+2*font.pad)/font.em+(style?.lineSpace||0)*scale*fit;const align=(flags: any,min: any,max: any)=>flags||((min<0&&max>0)?2:(min>=0?1:3));const h=align((n.textFlags>>4)&3,n.boxMin[0],n.boxMax[0]),v=align((n.textFlags>>7)&3,-n.boxMax[1],-n.boxMin[1]);let y=lo[1]+(v===2?(hi[1]-lo[1]-lines.length*lineHeight)/2:v===3?hi[1]-lo[1]-lines.length*lineHeight:0);
    let minX=Infinity,maxX=-Infinity,minY=y;for(const row of lines){let x=lo[0]+(h===2?(hi[0]-lo[0]-row.length)/2:h===3?hi[0]-lo[0]-row.length:0);minX=Math.min(minX,x);maxX=Math.max(maxX,x+row.length);for(const {g,char}of row.line){if(g&&char!==' ')rect(x+fw*(font.pad+g[6])/font.em,y+fh*(font.pad+g[7])/font.em,fw*g[3]/font.em,fh*g[4]/font.em,(g[1]-.5)/font.width,(g[2]-.5)/font.height,(g[3]+1)/font.width,(g[4]+1)/font.height,world.c);x+=(g?g[5]*fw:0)+space;}y+=lineHeight;}this.hit.push({id:n.id,x:minX-10*fit,y:minY-5*fit,w:maxX-minX+20*fit,h:y-minY+10*fit});
   }
   const count=data.length/8-start;if(!count)continue;const params=new Float32Array(36);params.set(n.params);for(const state of[s,mat])for(const [k,v]of Object.entries<any>(state.params||{}))params[Number(k)]=v;params.set([ox,oy,1/(720*fit),0],28);params[32]=Number(!!fontKey);device.queue.writeBuffer(draw.buffer,0,params);const additive=(n.flags&255)===4?1:0;commands.push({start,count,additive,binding:fontKey?draw.fontBindings[fontKey][additive]:(n.id===61&&this.r.photo?.collected()?this.cleanBindings:draw.bindings)[additive]});
  }
  // Authored brightness gauge spans the original left column.
  const gauge=resolve(nodes.findIndex((n: any)=>n.id===40)),a=point(xy(gauge.m,[-14.2,-14])),b=point(xy(gauge.m,[24.2,-14]));this.hit.unshift({id:40,x:a[0],y:a[1]-15*fit,w:b[0]-a[0],h:30*fit});
  if(data.length*4>this.vertices.size)throw Error('UI vertex budget exceeded');device.queue.writeBuffer(this.vertices,0,new Float32Array(data));const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.target.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});pass.setVertexBuffer(0,this.vertices);for(const c of commands){pass.setPipeline(this.pipelines[c.additive]);pass.setBindGroup(0,c.binding);pass.draw(c.count,1,c.start);}pass.end();const output=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});output.setPipeline(this.composite);output.setBindGroup(0,this.outputBinding);output.draw(3);output.end();device.queue.submit([encoder.finish()]);if(this.closing&&!this.players.players.some((p: any)=>p.animation===this.r.animations.get('/Assets/sh/ui/ModelAsset/sys_option/Scenes/UI_sys_opt_setout.uia')&&p.time*60*p.speed<p.animation.frames)){this.closing.resolve();this.closing=null;}
 }
}
// Render the two authored UI cues through the native mixer once. A separate
// Web Audio context plays them while the gameplay mixer remains suspended.
export async function decodeMenuSounds(w: any,file: any){
 const archive=await new Psarc(file).open(),sounds=new Map();const str=(s: any,fn: any)=>{const b=new TextEncoder().encode(s+'\0'),p=w._malloc(b.length);try{w.HEAPU8.set(b,p);return fn(p);}finally{w._free(p);}};
 w._audio_reset();try{
 for(const name of ['Init.bnk','sys_resident.sbp']){const bytes=await archive.read('as/sh/sound/asset/'+name),p=w._malloc(bytes.length);try{w.HEAPU8.set(bytes,p);if(!str(name,(n: any)=>w._audio_load(n,p,bytes.length,Number(name.endsWith('.sbp')))))throw Error(w.UTF8ToString(w._audio_error()));}finally{w._free(p);}}
 if(!w._audio_start(1))throw Error(w.UTF8ToString(w._audio_error()));
 for(const name of ['Play_sys_cursor_01','Play_sys_change_01']){w._audio_stop();const playing=str(name,(p: any)=>w._audio_post(p,0,0,0,0));if(!playing)throw Error('Falta sonido original: '+name);const samples=[];let frames=0;do{const p=w._audio_render(1024);samples.push(w.HEAPF32.slice(p/4,p/4+2048));frames+=1024;}while(w._audio_effect_alive(playing)&&frames<48000*5);if(w._audio_effect_alive(playing))throw Error('Sonido de menú sin final: '+name);const pcm=new Float32Array(frames*2);samples.forEach((s: any,i: any)=>pcm.set(s,i*2048));sounds.set(name,pcm);}
 return sounds;
 }finally{w._audio_reset();}
}
