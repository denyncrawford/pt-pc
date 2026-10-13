import createMenuAudio from './audio-core.js';
import {loadNativeUi,NativeMenu,decodeMenuSounds} from './native-ui.js';
import {prepareLamp} from './lamp.js';
import {preparePost,createPost} from './postprocess.js';
import {trackGpu} from './gpu-resources.js';
import {characterWGSL} from './material-shading.js';
import {materialWGSL} from './materials.js';
import {createPlayerBody} from './player-body.js';
import {prepareAudio,prepareLocatorSounds,primeStageAudio,HallwayAcoustics,SceneSoundSources} from './audio.js';
import {prepareFirstLoop,prepareOpening,openingHandoff,inverseRigid,transformPoint} from './first-loop.js';
import {createLighting,lightingWGSL} from './lighting.js';
import {Qar,uploadMaterials} from './materials.js';
import {createPointerCapture,loadHallway,prepareLocomotion,stepPlayer,PHYSICS_STEP,PlayerZoom} from './runtime.js';
import createGeometry from './geometry.js';
import { discoverModels, MAX_ENTRY } from './archives.js';
const $ = id => document.getElementById(id), canvas = $('canvas');
const status = message => { $('status').textContent = message; };
function fail(error) { $('error').textContent = error.message || String(error); console.error(error); }
let post=null,outputFormat;
let texturedPipeline,emissivePipeline,decalPipeline,capturePipeline,lightingSystem,sceneLighting,frameLayout;
let device, context, pipeline, bindGroup, uniform, depth, wasm, mesh, modelList = [];
let walking = false, spawn, accumulator=0, inputActive=false, walkSummary='';
let pointerCapture=null;let menuPaused=false;const preferences={sensitivity:1,invertX:false,brightness:1,invertY:false,subtitles:true,language:"Spa",volume:1,renderScale:1};
export function configureGame(values){Object.assign(preferences,values);gameAudio?.setVolume(preferences.volume);if(gameAudio&&gameAudio.language!==preferences.language)gameAudio.setLanguage(preferences.language).catch(e=>{$('menu-error').textContent=e.message;});}
export function setMenuPaused(value){menuPaused=value;if(value){acoustics?.lamp?.suspend();pauseWalk();pointerCapture?.release();}}
const controlsActive=()=>!menuPaused&&(document.pointerLockElement===canvas && document.hasFocus());
let gameAudio=null,acoustics=null,locomotion=null,playerBody=null,playerFeet=[0,0,0];
let nextSession=null,sessionGeneration=0,transitioning=false;
const playerZoom=new PlayerZoom();
let firstLoop=null, walkScene=null, cameraFov=2*Math.atan(6.75/13), eventAccumulator=0, refreshShadows=false;
let cameraBasis=null;
let camera = [0, 1.6, 4], yaw = 0, pitch = 0, keys = new Set(), last = 0, busy = false, revision = 0;
const shader = `
struct Frame { vp: mat4x4<f32>, eye: vec4<f32>, forward: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
struct Out { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32> };
@vertex fn vs(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> Out {
  var o: Out; o.clip=frame.vp*vec4(p,1); o.world=p; o.normal=n; return o;
}
@fragment fn fs(o: Out) -> @location(0) vec4<f32> {
  let delta=frame.eye.xyz-o.world; let dist=max(length(delta),0.001);
  let n=normalize(o.normal+vec3(0.00001));
  let cone=smoothstep(0.76,0.96,dot(-delta/dist,frame.forward.xyz));
  let diffuse=abs(dot(n,delta/dist));
  let light=0.13+cone*diffuse*4.0/(1.0+dist*dist*0.09);
  let checker=0.92+0.08*cos(o.world.x*6.0)*cos(o.world.z*6.0);
  let albedo=mix(vec3(0.28,0.32,0.27),vec3(0.55,0.48,0.35),abs(n.y));
  let color=albedo*checker*light;
  return vec4(pow(mix(vec3(0.015,0.022,0.02),color,exp(-dist*0.025)),vec3(1.0/2.2)),1);
}`;
const texturedShader=shader
 .replace('struct Out {',materialWGSL+characterWGSL+'@group(1) @binding(0) var materialSampler: sampler;\n@group(1) @binding(1) var baseTex: texture_2d<f32>;\n@group(1) @binding(2) var normalTex: texture_2d<f32>;\n@group(1) @binding(3) var specTex: texture_2d<f32>;\n@group(1) @binding(4) var<uniform> material: Material;\n@group(1) @binding(5) var translucentTex:texture_2d<f32>;\n@group(1) @binding(6) var shiftTex:texture_2d<f32>;\n@group(1) @binding(7) var irisTex:texture_2d<f32>;\n@group(1) @binding(8) var lensTex:texture_2d<f32>;\n@group(1) @binding(9) var eyeReflectionTex:texture_2d<f32>;\n@group(1) @binding(10) var fresnelLut:texture_2d<f32>;\n@group(1) @binding(11) var ndfLut:texture_3d<f32>;\n@group(1) @binding(12) var lutSampler:sampler;\nstruct Out {')
 .replace('@location(1) normal: vec3<f32> }','@location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, @location(3) tangent:vec4<f32> }')
 .replace('@location(1) n: vec3<f32>)','@location(1) n: vec3<f32>, @location(2) uv: vec2<f32>, @location(3) tangent:vec4<f32>)')
 .replace('o.normal=n;','o.normal=n; o.uv=uv; o.tangent=tangent;')
 .replace('let n=normalize(o.normal+vec3(0.00001));', `
  selectedColor=material.tableColor;selectedParams=material.tableParams;
  let mapSize=textureDimensions(lensTex,0);let mapUV=vec2<i32>(fract(o.uv)*vec2<f32>(mapSize));
  let selector=textureLoad(lensTex,mapUV,0).r;
  if(material.multi.x>1.0&&selector>=0.25){selectedColor=material.color1;selectedParams=material.params1;}
  if(material.multi.x>2.0&&selector>=0.5){selectedColor=material.color2;selectedParams=material.params2;}
  if(material.multi.x>3.0&&selector>=0.75){selectedColor=material.color3;selectedParams=material.params3;}
  let geometric=normalize(o.normal+vec3(0.00001));
  let dx=dpdx(o.world); let dy=dpdy(o.world);let ux=dpdx(o.uv);let uy=dpdy(o.uv);
  var t=cross(dy,geometric)*ux.x+cross(geometric,dx)*uy.x;
  var b=cross(dy,geometric)*ux.y+cross(geometric,dx)*uy.y;
  if(dot(o.tangent.xyz,o.tangent.xyz)>1e-8){t=normalize(o.tangent.xyz);b=normalize(cross(geometric,t))*o.tangent.w;}
  let scale=inverseSqrt(max(max(dot(t,t),dot(b,b)),0.000001));
  let nt=textureSample(normalTex,materialSampler,o.uv);var xy=select(nt.rg,nt.ag,material.micro.w>0.5)*2.0-1.0;
  let nz=sqrt(max(0.0,1.0-dot(xy,xy))+1.00016594e-4);
  let detail=textureSample(shiftTex,materialSampler,o.uv*material.subnormal.yz);
  let mask=textureSample(translucentTex,materialSampler,o.uv).r;
  if(material.subnormal.w>0.5){xy+=material.subnormal.x*mask*(detail.ag*2.0-1.0);}
  let n=normalize(t*scale*xy.x+b*scale*xy.y+geometric*nz);
  let base=textureSample(baseTex,materialSampler,o.uv);
  var spec=textureSample(specTex,materialSampler,o.uv).rgb;
  if(base.a<characterAlpha(o.clip.xy)){discard;}
 `)
 .replace('let albedo=mix(vec3(0.28,0.32,0.27),vec3(0.55,0.48,0.35),abs(n.y));',`var albedo=base.rgb;let view=normalize(frame.eye.xyz-o.world);let tangent=normalize(t+vec3(1e-12));let bitangent=normalize(b+vec3(1e-12));
 if(material.micro.z>0.5){
 let r18=0.5/max(material.micro.y,0.001);let r20=1.0/max(1.0-r18,0.001);
 let rough=spec.g+clamp(r18*r20-dot(n,view)*r20,0.0,1.0)*(spec.g*material.micro.x-spec.g);
 let r23=clamp(rough/max(0.001,spec.g),0.0,1.0);spec.b=1.0-(r23-spec.b*r23);spec.g=rough;
 }
 if(material.repeat.z>1.5){
  let vts=vec3(dot(view,tangent),dot(view,bitangent),dot(view,geometric));let height=textureSample(lensTex,materialSampler,o.uv).g;
  let iris=textureSample(irisTex,materialSampler,o.uv-0.25*material.repeat.w*height*vec2(vts.x,-vts.y)/select(-max(abs(vts.z),1e-4),max(abs(vts.z),1e-4),vts.z>=0.0)).rgb;
  let right=normalize(vec3(frame.vp[0].x,frame.vp[1].x,frame.vp[2].x));let up=normalize(vec3(frame.vp[0].y,frame.vp[1].y,frame.vp[2].y));
  let sphere=textureSample(eyeReflectionTex,materialSampler,vec2(0.5-0.5*dot(n,right),0.5-0.5*dot(n,up))).rgb;
  albedo=srgbDecode(clamp(sphere*spec.r+mix(srgbEncode(albedo),iris,1.0-pow(1.0-height,4.0)),vec3(0),vec3(1)));
 }
 var highlight=spec.r;if(material.surface.y>0.5){highlight=nativeHair(geometric,tangent,bitangent,view,textureSample(shiftTex,materialSampler,o.uv*material.repeat.xy).r,spec.r);spec.r=highlight;}
 let rim=material.incidence.a*highlight*pow(clamp(1.0-dot(select(n,geometric,material.surface.y>0.5),view),0.0,1.0),max(material.surface.x,0.001));
 albedo=srgbDecode(mix(srgbEncode(albedo),material.incidence.rgb,rim));`)
 .replace('vec3(1.0/2.2)),1);','vec3(1.0/2.2)),mix(1.0,base.a,material.flags.y));')
 .replace('let color=albedo*checker*light;','let color=albedo*light+spec*pow(max(0.0,dot(n,delta/dist)),24.0)*cone*0.12;');
const litShader=lightingWGSL+texturedShader
 .replace('@fragment fn fs(o: Out) -> @location(0) vec4<f32> {', '@fragment fn fs(o: Out) -> @location(0) vec4<f32> {receiverNormal=normalize(cross(dpdx(o.world),dpdy(o.world)));')
 .replace('var albedo=base.rgb;', 'shadowPixel=o.clip.xy;var albedo=base.rgb;')
 .replace('let color=albedo*light+spec*pow(max(0.0,dot(n,delta/dist)),24.0)*cone*0.12;', 'if(frame.forward.w>1.5&&dot(mirror.plane,vec4(o.world,1))<0.001){discard;} if(material.repeat.z>0.5){let k=selectedParams.z*(1.0-spec.b)+spec.b;let amount=selectedParams.z*k;albedo=albedo*(1.0-(selectedParams.z*(1.0-spec.r)+spec.r)*amount)+reflected(o.world,n,frame.eye.xyz,spec);} var color=sceneLighting(o.world,n,frame.eye.xyz,albedo,spec,textureSample(translucentTex,materialSampler,o.uv).g*material.flags.w,normalize(b*scale+vec3(1e-8)),textureSample(shiftTex,materialSampler,o.uv*material.repeat.xy).r);if(material.repeat.z<0.5){color+=reflected(o.world,n,frame.eye.xyz,spec);}if(material.flags.z>0.5&&frame.forward.w<0.5&&mirror.config.x>0.5){color=mirrorColor(o.world)*0.9+color*0.1;}')
 .replace('return vec4(pow(mix(vec3(0.015,0.022,0.02),color,exp(-dist*0.025)),vec3(1.0/2.2)),mix(1.0,base.a,material.flags.y));','if(material.repeat.z< -0.5){let alpha=clamp(material.incidence.a*base.a,0.0,1.0);if(alpha<0.001){discard;}color=material.incidence.rgb*base.rgb*material.surface.x;if(frame.forward.w>0.5){return vec4(color,alpha);}let mapped=vec3(1)-exp(-max(color,vec3(0))*0.012);return vec4(pow(mapped,vec3(1.0/2.2)),alpha);}if(frame.forward.w>0.5){return vec4(color,1); } let mapped=vec3(1)-exp(-max(color,vec3(0))*0.012);return vec4(pow(mapped,vec3(1.0/2.2)),mix(1.0,base.a,material.flags.y));');
// Main view retains linear HDR and the native diffuse-only metering channel.
const hdrShader=litShader.replace('@fragment fn fs(o: Out) -> @location(0) vec4<f32>', 'struct HdrOut{@location(0) color:vec4<f32>,@location(1) diffuse:vec4<f32>,@location(2) normal:vec4<f32>}; @fragment fn fs(o: Out) -> HdrOut')
 .replace(/if\(material.repeat.z< -0.5\)\{let alpha[\s\S]*$/, 'if(material.repeat.z< -0.5){let alpha=clamp(material.incidence.a*base.a,0.0,1.0);if(alpha<0.001){discard;}return HdrOut(vec4(material.incidence.rgb*base.rgb*material.surface.x,alpha),vec4(0),vec4(0));}return HdrOut(vec4(color,mix(1.0,base.a,material.flags.y)),vec4(measuredDiffuse,1),vec4(n,spec.g));}');

function multiply(a,b) {
  const out = new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
function forward() { return [Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch)]; }
function projectionView() {
  const f=forward(),r=cameraBasis?.right||[Math.cos(yaw),0,Math.sin(yaw)],u=cameraBasis?.up||[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
  const dot = v => v.reduce((sum,x,i)=>sum+x*camera[i],0);
  const v=new Float32Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-dot(r),-dot(u),dot(f),1]);
  const t=1/Math.tan(cameraFov/2),n=0.02,z=2000;
  const p=new Float32Array([t/(canvas.width/canvas.height),0,0,0,0,t,0,0,0,0,z/(n-z),-1,0,0,z*n/(n-z),0]);
  return multiply(p,v);
}
function createMesh(vertices, indices, name, surface=null) {
  if(!indices.length || vertices.length%6) throw new Error('Geometría vacía o inválida');
  const vb=device.createBuffer({size:vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const ib=device.createBuffer({size:indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(vb,0,vertices); device.queue.writeBuffer(ib,0,indices);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=6) for(let j=0;j<3;j++) { min[j]=Math.min(min[j],vertices[i+j]); max[j]=Math.max(max[j],vertices[i+j]); }
  let uvb;if(surface){const uvData=new Float32Array(surface.uvs.length*3);for(let i=0;i<surface.uvs.length/2;i++){uvData.set(surface.uvs.subarray(i*2,i*2+2),i*6);if(surface.tangents)uvData.set(surface.tangents.subarray(i*4,i*4+4),i*6+2);}surface.uvData=uvData;uvb=device.createBuffer({size:uvData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uvb,0,uvData);}
  return {vb,ib,count:indices.length,min,max,name,surface,uvb};
}
function upload(vertices,indices,name,surface=null){
 const replacement=createMesh(vertices,indices,name,surface);
 post?.destroy();post=null;sceneLighting?.destroy();sceneLighting=null;destroyMesh(mesh);mesh=replacement;frameModel();
}
function destroyMesh(value){value?.vb.destroy();value?.ib.destroy();value?.uvb?.destroy();for(const t of value?.surface?.textures||[])t.destroy();for(const b of value?.surface?.buffers||[])b.destroy();}

function frameModel() {
  if(!mesh) return;
  const center=mesh.min.map((v,i)=>(v+mesh.max[i])/2),radius=Math.max(...mesh.min.map((v,i)=>mesh.max[i]-v),1);
  camera=[center[0],center[1],center[2]+radius*0.9]; yaw=0; pitch=0;
}
function demo() {
  playerBody?.destroy();playerBody=null;gameAudio?.destroy();gameAudio=null;acoustics=null;firstLoop?.destroy();firstLoop=null;
  walking=false;
  const vertices=[], indices=[];
  function box(cx,cy,cz,sx,sy,sz) {
    const faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],[[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],[[0,0,1],[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],[[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
    for(const [normal,points] of faces) { const base=vertices.length/6;
      for(const p of points) vertices.push(cx+p[0]*sx,cy+p[1]*sy,cz+p[2]*sz,...normal);
      indices.push(base,base+1,base+2,base,base+2,base+3); }
  }
  box(0,-0.15,-7,1.8,0.15,12);box(0,3.15,-7,1.8,0.15,12);
  box(-1.8,1.5,-7,0.15,1.5,12);box(1.8,1.5,-7,0.15,1.5,12);box(0,1.5,-19,1.8,1.5,0.15);
  for(let z=0;z>=-15;z-=5) {box(-1.6,1.5,z,0.13,1.5,0.08);box(1.6,1.5,z,0.13,1.5,0.08);box(0,2.85,z,1.65,0.15,0.08);}
  upload(new Float32Array(vertices),new Uint32Array(indices),'Pasillo sintético · no es el mapa de P.T.');
  camera=[0,1.6,3]; yaw=0; pitch=0;
}
async function loadModel(index) {
  if(!modelList[index] || busy) return;
  busy=true; $('error').textContent=''; $('models').disabled=true;
  const token=revision;
  try {
    const model=modelList[index]; status('Decodificando en WASM: '+model.name);
    const bytes=await model.read(); if(token!==revision) return;
    if(bytes.length>MAX_ENTRY) throw new Error('Modelo demasiado grande');
    const ptr=wasm._malloc(bytes.length); if(!ptr) throw new Error('Memoria insuficiente');
    try {
      wasm.HEAPU8.set(bytes,ptr);
      let size=bytes.length;
      if(bytes[0]===0x1b || bytes[0]===0x1c) {
        const name=new TextEncoder().encode(model.name+'\0'),np=wasm._malloc(name.length);
        if(!np)throw new Error('Memoria insuficiente');
        try {wasm.HEAPU8.set(name,np);size=wasm._decrypt_entry(ptr,size,np);}finally{wasm._free(np);}
        if(!size)throw new Error('No se pudo descifrar la entrada FPK');
      }
      const result=wasm._decode_fmdl(ptr,size);
      if(result) throw new Error('FMDL no compatible o inválido (código '+result+'). Este visor admite geometría estática, posiciones float32/float16 y normales.');
      const vertices=wasm.HEAPF32.slice(wasm._vertex_ptr()/4,wasm._vertex_ptr()/4+wasm._vertex_count()*6);
      const indices=wasm.HEAPU32.slice(wasm._index_ptr()/4,wasm._index_ptr()/4+wasm._index_count());
      walking=false;
      upload(vertices,indices,model.name+' · geometría sin materiales originales');
      return true;
    } finally {wasm._free(ptr);wasm._release_geometry();}
  } catch(e) { fail(e); status('No se pudo cargar el modelo. La escena anterior sigue disponible.'); return false; }
  finally {busy=false;$('models').disabled=false;}
}
function frame(time) {
  const dt=Math.min((time-last)/1000,0.05);last=time;
  const w=Math.min(1920,Math.max(1,Math.round(canvas.clientWidth*Math.min(devicePixelRatio,1.5)*preferences.renderScale)));
  const h=Math.min(1080,Math.max(1,Math.round(canvas.clientHeight*Math.min(devicePixelRatio,1.5)*preferences.renderScale)));
  if(canvas.width!==w||canvas.height!==h||!depth) {canvas.width=w;canvas.height=h;depth?.destroy();depth=device.createTexture({size:[w,h],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});}
  if(walking && !firstLoop?.completed && firstLoop?.phase!=='sequence') {
    const active=controlsActive() && !document.hidden && (!gameAudio||gameAudio.active);
    let z=active?(Number(keys.has('KeyW'))-Number(keys.has('KeyS'))):0;
    let x=active?(Number(keys.has('KeyD'))-Number(keys.has('KeyA'))):0;
    const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
    accumulator+=dt;
    while(accumulator>=PHYSICS_STEP) {
      const pose=active?locomotion.step(x,z,yaw,PHYSICS_STEP):locomotion.pose;
      playerZoom.update(PHYSICS_STEP,active&&keys.has("Zoom"));cameraFov=playerZoom.fov();
      const p=stepPlayer(wasm,active?pose[0]:0,active?pose[1]:0);
      playerFeet=[...p].slice(0,3);const drawn=wasm._player_draw_position()/4;camera=locomotion.camera(wasm.HEAPF32.subarray(drawn,drawn+3));
      if(active&&pose[2])for(let contact=0;contact<pose[2];contact++)acoustics?.contact(!!pose[3],[...p].slice(0,3)); acoustics?.update([...p].slice(0,3),!!p[3],camera,PHYSICS_STEP,active); accumulator-=PHYSICS_STEP;
      if(firstLoop){eventAccumulator+=PHYSICS_STEP;if(eventAccumulator>=1/30){eventAccumulator=0;try{firstLoop.cameraPose={camera:[...camera],yaw,pitch,fov:cameraFov,basis:cameraBasis};firstLoop.tick([...p].slice(0,3),yaw,[(Math.sin(yaw)*z+Math.cos(yaw)*x),(-Math.cos(yaw)*z+Math.sin(yaw)*x)]);}catch(e){walking=false;fail(e);break;}if(firstLoop.phase==='sequence'){accumulator=0;status('Abriendo la puerta · secuencia original gc_p00_010');refreshShadows=true;break;}}}
      if(!camera.every(Number.isFinite)||p[1]<spawn.position[1]-8){resetPlayer();break;}
    }
  } else if(!walking && document.pointerLockElement===canvas) {
    const speed=(keys.has('ShiftLeft')?8:2.5)*dt;
    const z=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),x=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
    camera[0]+=(Math.sin(yaw)*z+Math.cos(yaw)*x)*speed;camera[2]+=(-Math.cos(yaw)*z+Math.sin(yaw)*x)*speed;
    camera[1]+=(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*speed;
  }
  if(walking&&!menuPaused&&firstLoop&&!firstLoop.completed)try{sceneLighting?.setTransition(firstLoop.ready&&!firstLoop.rebased);
    const view=firstLoop.update(document.hidden?0:dt);if(view){camera=view.camera;yaw=view.yaw;pitch=view.pitch;cameraFov=view.fov;cameraBasis=view.basis||null;}
    if(firstLoop.dirtyDoor){device.queue.writeBuffer(mesh.vb,0,firstLoop.vertices);for(let i=0;i<mesh.surface.tangents.length/4;i++)mesh.surface.uvData.set(mesh.surface.tangents.subarray(i*4,i*4+4),i*6+2);device.queue.writeBuffer(mesh.uvb,0,mesh.surface.uvData);firstLoop.dirtyDoor=false;refreshShadows=true;}
    if(view?.exit&&!transitioning){transitioning=true;commitOpeningExit(view).catch(e=>{transitioning=false;fail(e);});}
    if(view?.transferred){playerZoom.reset();cameraBasis=null;playerFeet=[...view.position];locomotion?.reset(view.yaw);locomotion?.handCameraBack(camera,playerFeet);acoustics?.reset();sceneLighting.finishTransition();cameraFov=2*Math.atan(6.75/13);keys.clear();if(firstLoop.completed)pauseWalk();status(view.opening?'Habitación inicial · acércate a la puerta para salir al pasillo':firstLoop.completed?'Recorrido completado hasta f030: f010 → f005 → f020 → f030. f030 sólo se presenta como destino; sus eventos aún no están implementados. La fidelidad visual sigue en revisión. Vuelve a Biblioteca para reiniciar.':firstLoop.floor==='f030'?'Etapa f030 · puertas y eventos iniciales activos. Interacción de mirada del baño y salida a f040 en implementación.':'Etapa '+firstLoop.floor+'. Retrocede tras encontrar las cucarachas para activar el evento del baño antes de volver a la salida. Reloj y audio originales activos.');}
  }catch(e){walking=false;fail(e);}
  $('opening-fade').style.opacity=firstLoop?.opening?firstLoop.fade:0;
  if(gameAudio){acoustics?.lamp?.update(firstLoop?.floor,menuPaused||document.hidden);if(!menuPaused&&!document.hidden){acoustics?.ambience?.update(camera,dt);acoustics?.locators?.update();}gameAudio.listener(camera,forward());acoustics?.sources?.update(camera,document.hidden||menuPaused?0:dt);const sub=$('subtitles');if(sub)sub.textContent=preferences.subtitles?gameAudio.clock.text(gameAudio.time):'';const audioStatus=$('audio-status');if(audioStatus)audioStatus.textContent=gameAudio.active?'Audio activo':'Audio en pausa · pulsa Jugar';const meter=$('audio-meter');if(meter)meter.textContent='Audio: '+gameAudio.time.toFixed(2)+' s · nivel '+gameAudio.peak.toFixed(3);}
  if($('walk-debug'))$('walk-debug').textContent='Posición: '+camera.map(n=>n.toFixed(2)).join(', ')+' · giro '+(yaw*180/Math.PI).toFixed(1)+'°'+(firstLoop?.blocking.length?' · Para salir falta: '+firstLoop.blocking.join(', '):'')+(acoustics?' · pasos '+acoustics.steps+' · obstrucción '+acoustics.blocked.toFixed(2)+' · suelo '+(acoustics.material>>>0).toString(16)+' · zona '+(acoustics.zone.split('|').at(-1)||'exterior'):'')+(locomotion?' · anim '+['marcha','arranque','parada'][locomotion.pose[10]]+'/'+locomotion.pose[9]+' @'+locomotion.pose[8].toFixed(1):'')+(playerBody?' · jugador '+playerBody.mesh.vertices.length/6+' vértices · '+playerBody.surface.count+' mapas'+(playerBody.surface.tableFallback?' · tabla de materiales: fallback nativo; reimporta la biblioteca':' · tabla original: 256 × 2')+(playerBody.surface.missing.length?' · faltan '+playerBody.surface.missing.length:''):'');
  const data=new Float32Array(24);data.set(projectionView());data.set([...camera,1],16);data.set([...forward(),0],20);device.queue.writeBuffer(uniform,0,data);
  if(post)post.resize(w,h);
  if(nextSession&&firstLoop?.opening){const c=nextSession,frame=new Float32Array(24);frame.set(multiply(data.subarray(0,16),c.toRoom));frame.set([...transformPoint(c.toHallway,camera),1],16);frame.set([...transformPoint(c.toHallway,forward(),0),0],20);device.queue.writeBuffer(c.previewUniform,0,frame);}

  const encoder=device.createCommandEncoder();if(playerBody&&walking&&!menuPaused){playerBody.visible=true;playerBody.update(encoder,playerFeet,firstLoop?.phase==='sequence'?firstLoop:null);}if(refreshShadows){sceneLighting?.refreshShadows(encoder);refreshShadows=false;}sceneLighting?.renderMirror(encoder,data.subarray(0,16),camera,playerBody);const pass=encoder.beginRenderPass({colorAttachments:[{view:post?post.hdr:context.getCurrentTexture().createView(),clearValue:{r:0.015,g:0.022,b:0.02,a:1},loadOp:'clear',storeOp:'store'},...(post?[{view:post.diffuse,clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'},{view:post.normal,clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]:[])],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
  if(mesh && (!mesh.surface||(sceneLighting&&post))) {if(mesh.surface)pass.setBindGroup(2,sceneLighting.group);pass.setPipeline(mesh.surface?texturedPipeline:pipeline);pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,mesh.vb);pass.setIndexBuffer(mesh.ib,'uint32');if(mesh.surface){pass.setVertexBuffer(1,mesh.uvb);for(const g of mesh.surface.groups){if(g.visible===false||g.emissive)continue;pass.setPipeline(g.decal?decalPipeline:(g.emissive?emissivePipeline:texturedPipeline));pass.setBindGroup(1,g.binding);pass.drawIndexed(g.count,1,g.first);}}else pass.drawIndexed(mesh.count);}
  // Both rooms share the depth target. Each uses its own original world lighting.
  if(nextSession&&firstLoop?.opening&&post){const c=nextSession;pass.setBindGroup(0,c.previewBinding);pass.setBindGroup(2,c.lighting.group);pass.setVertexBuffer(0,c.mesh.vb);pass.setVertexBuffer(1,c.mesh.uvb);pass.setIndexBuffer(c.mesh.ib,'uint32');const entry=c.scene.placements.find(p=>p.name.endsWith('_hallway_in'));for(const g of c.mesh.surface.groups){if(g.visible===false||g.stage||g.emissive||g.modelIndex===entry?.modelIndex)continue;pass.setPipeline(g.decal?decalPipeline:texturedPipeline);pass.setBindGroup(1,g.binding);pass.drawIndexed(g.count,1,g.first);}pass.setBindGroup(0,bindGroup);pass.setBindGroup(2,sceneLighting.group);}
  if(playerBody&&walking&&sceneLighting&&post){pass.setPipeline(texturedPipeline);pass.setBindGroup(0,bindGroup);pass.setBindGroup(2,sceneLighting.group);playerBody.draw(pass);}
  pass.end();if(post){post.brightness=preferences.brightness;}if(post)post.render(encoder,context.getCurrentTexture().createView(),(document.hidden||menuPaused)?0:dt,firstLoop?.floor,depth,data,($('reflections')?.checked??true),(view)=>{
   const forwardPass=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'load',storeOp:'store'},{view:post.diffuse,loadOp:'load',storeOp:'store'},{view:post.normal,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
   forwardPass.setPipeline(emissivePipeline);forwardPass.setBindGroup(0,bindGroup);forwardPass.setBindGroup(2,sceneLighting.group);forwardPass.setVertexBuffer(0,mesh.vb);forwardPass.setVertexBuffer(1,mesh.uvb);forwardPass.setIndexBuffer(mesh.ib,'uint32');
   for(const g of mesh.surface.groups)if(g.visible!==false&&g.emissive){forwardPass.setBindGroup(1,g.binding);forwardPass.drawIndexed(g.count,1,g.first);}
   if(nextSession&&firstLoop?.opening){const c=nextSession;forwardPass.setBindGroup(0,c.previewBinding);forwardPass.setBindGroup(2,c.lighting.group);forwardPass.setVertexBuffer(0,c.mesh.vb);forwardPass.setVertexBuffer(1,c.mesh.uvb);forwardPass.setIndexBuffer(c.mesh.ib,'uint32');for(const g of c.mesh.surface.groups)if(g.visible!==false&&!g.stage&&g.emissive){forwardPass.setBindGroup(1,g.binding);forwardPass.drawIndexed(g.count,1,g.first);}}
   forwardPass.end();
  });device.queue.submit([encoder.finish()]);requestAnimationFrame(frame);
}
async function init() {
  if(!navigator.gpu) throw new Error('WebGPU no está disponible. Abre esta página en localhost o HTTPS con un navegador y GPU compatibles.');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter) throw new Error('No se encontró un adaptador WebGPU');
  device=trackGpu(await adapter.requestDevice({requiredFeatures:adapter.features.has('texture-compression-bc')?['texture-compression-bc']:[]}));device.addEventListener('uncapturederror',e=>fail(e.error));
  device.lost.then(info=>fail(new Error('Se perdió el dispositivo GPU: '+info.message+'. Recarga la página.')));
  context=canvas.getContext('webgpu');const format=navigator.gpu.getPreferredCanvasFormat();outputFormat=format;context.configure({device,format,alphaMode:'opaque'});
  frameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
  const materialLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{}},...[1,2,3,5,6,7,8,9,10].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{}})),{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:11,visibility:GPUShaderStage.FRAGMENT,texture:{viewDimension:'3d'}},{binding:12,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
  const module=device.createShaderModule({code:shader}),compilation=await module.getCompilationInfo();
  const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length) throw new Error(errors.map(m=>m.message).join('\n'));
  pipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout]}),vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
  lightingSystem=await createLighting(device);
  const tm=device.createShaderModule({code:hdrShader}),cm=device.createShaderModule({code:litShader});
  const lightingErrors=(await tm.getCompilationInfo()).messages.filter(m=>m.type==='error');if(lightingErrors.length)throw Error(lightingErrors.map(m=>m.lineNum+': '+m.message).join('\n'));
  texturedPipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout,materialLayout,lightingSystem.layout]}),vertex:{module:tm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},{arrayStride:24,attributes:[{shaderLocation:2,offset:0,format:'float32x2'},{shaderLocation:3,offset:8,format:'float32x4'}]}]},fragment:{module:tm,entryPoint:'fs',targets:[{format:'rgba16float'},{format:'rgba16float'},{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
  decalPipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout,materialLayout,lightingSystem.layout]}),vertex:{module:tm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},{arrayStride:24,attributes:[{shaderLocation:2,offset:0,format:'float32x2'},{shaderLocation:3,offset:8,format:'float32x4'}]}]},fragment:{module:tm,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}},{format:'rgba16float',writeMask:0},{format:'rgba16float',writeMask:0}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal',depthBias:-1}});
  emissivePipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout,materialLayout,lightingSystem.layout]}),vertex:{module:tm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},{arrayStride:24,attributes:[{shaderLocation:2,offset:0,format:'float32x2'},{shaderLocation:3,offset:8,format:'float32x4'}]}]},fragment:{module:tm,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}},{format:'rgba16float',writeMask:0},{format:'rgba16float',writeMask:0}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'}});
  capturePipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[frameLayout,materialLayout,lightingSystem.layout]}),vertex:{module:cm,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},{arrayStride:24,attributes:[{shaderLocation:2,offset:0,format:'float32x2'},{shaderLocation:3,offset:8,format:'float32x4'}]}]},fragment:{module:cm,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
  uniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
  wasm=await createGeometry();demo();requestAnimationFrame(frame);
  $('demo').onclick=()=>{if(!busy)demo();};$('reset').onclick=()=>walking?resetPlayer():frameModel();
  canvas.tabIndex=0;
  pointerCapture=createPointerCapture({canvas,
   onCapture:()=>{inputActive=true;$('error').textContent='';gameAudio?.setVolume(preferences.volume);gameAudio?.resume().catch(fail);},
   onError:()=>{inputActive=false;document.dispatchEvent(new Event('game-pointer-error'));},
   onRelease:()=>{keys.clear();if(!menuPaused)document.dispatchEvent(new Event('game-pointer-released'));}
  });
  $('enter').onclick=()=>{firstLoop?.retryPreparation?.();pointerCapture.request();};
  canvas.addEventListener('pointerdown',()=>{if(!menuPaused&&document.pointerLockElement!==canvas)$('enter').click();});
  for(const id of ['shadows','reflections','indirect','mirrors'])if($(id))$(id).onchange=()=>sceneLighting?.setFeatures($('shadows').checked,$('reflections').checked,$('indirect').checked,$('mirrors').checked);
  $('inspect-mirror').onclick=()=>{
   if(!walking||busy||firstLoop?.phase==='sequence'||!walkScene?.mirrorPlane)return;
   const points=[];for(const g of walkScene.groups.filter(g=>g.mirror))for(let i=g.first;i<g.first+g.count;i++)points.push(walkScene.vertices.subarray(walkScene.indices[i]*6,walkScene.indices[i]*6+3));
   const center=[0,1,2].map(k=>(Math.min(...points.map(p=>p[k]))+Math.max(...points.map(p=>p[k])))/2),n=walkScene.mirrorPlane.slice(0,3);let x=center[0]+n[0]*1.1,z=center[2]+n[2]*1.1,floor=wasm._world_floor(x,center[1],z);if(Math.abs(center[1]-floor)>3){for(let i=0;i<3;i++)n[i]*=-1;x=center[0]+n[0]*1.1;z=center[2]+n[2]*1.1;floor=wasm._world_floor(x,center[1],z);}
   if(!Number.isFinite(floor)||Math.abs(center[1]-floor)>3)return;
   playerFeet=[x,floor+.01,z];wasm._player_spawn(...playerFeet);yaw=Math.atan2(-n[0],n[2]);pitch=0;locomotion.reset(yaw);acoustics.reset();camera=[x,floor+1.6,z];keys.clear();accumulator=0;status('Inspección del espejo · Caminar activa la animación. R vuelve a la entrada.');
  };
  $('models').onchange=()=>loadModel(Number($('models').value));
  $('files').onchange=()=>loadFiles([...$('files').files]);
  addEventListener('keydown',e=>{if(controlsActive()){if(e.code==='Escape'){inputActive=false;keys.clear();canvas.blur();gameAudio?.pause();return;}keys.add(e.code);if(e.code==='KeyR'&&walking&&firstLoop?.phase!=='sequence')resetPlayer();e.preventDefault();}});
  addEventListener('keyup',e=>keys.delete(e.code));
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(e.button===2&&controlsActive())keys.add('Zoom');});
  addEventListener('pointerup',e=>{if(e.button===2)keys.delete('Zoom');});addEventListener('blur',()=>keys.clear());
  document.addEventListener('pointerlockchange',()=>keys.clear());
  document.addEventListener('visibilitychange',()=>{if(document.hidden){acoustics?.lamp?.suspend();gameAudio?.pause();}});
  addEventListener('mousemove',e=>{if(firstLoop?.phase!=='sequence'&&controlsActive()){yaw+=e.movementX*0.002*preferences.sensitivity*(preferences.invertX?-1:1);pitch=Math.max(-1.5,Math.min(1.5,pitch-e.movementY*0.002*preferences.sensitivity*(preferences.invertY?-1:1)));}});
}
function resetPlayer() {
  if(firstLoop?.completed)return;
  playerZoom.reset();post?.reset();locomotion?.reset(spawn.yaw);acoustics?.reset();keys.clear();accumulator=0;cameraFov=2*Math.atan(6.75/13);wasm._player_spawn(...spawn.position);playerFeet=[...spawn.position];
  camera=[spawn.position[0],spawn.position[1]+1.6,spawn.position[2]];yaw=spawn.yaw;pitch=0;
}
// Release a complete play session before returning to the wizard or loading again.
export async function unloadWalk({transfer=false}={}){
 ++sessionGeneration;const disposingNext=nextSession?.destroy();nextSession=null;transitioning=false;
 if(!transfer)pauseWalk();else keys.clear();walking=false;cameraBasis=null;$('opening-fade').style.opacity=0;firstLoop?.destroy();firstLoop=null;
 playerBody?.destroy();playerBody=null;acoustics?.lamp?.destroy();acoustics?.locators?.destroy();const audio=gameAudio;gameAudio=null;
 post?.destroy();post=null;sceneLighting?.destroy();sceneLighting=null;
 mesh?.vb.destroy();mesh?.ib.destroy();mesh?.uvb?.destroy();
 for(const t of mesh?.surface?.textures||[])t.destroy();
 for(const b of mesh?.surface?.buffers||[])b.destroy();
 mesh=null;walkScene=null;locomotion=null;acoustics=null;spawn=null;
 wasm?._world_clear();await audio?.destroy();await disposingNext;
 if(!walking)document.documentElement.dataset.sessionResources=JSON.stringify({...device.resourceSnapshot(),audioContexts:0,session:false});
}
// Prepare into a separate WASM world; failures never clear the active scene.
async function prepareSession(file,textureFile,onProgress=()=>{},kind='start'){
 const candidate={floor:kind==='start'?'f000':'f010',wasm:await createGeometry(),kind};let destroyed=false;
 candidate.destroy=()=>{if(destroyed)return;destroyed=true;candidate.acoustics?.lamp?.destroy();candidate.acoustics?.locators?.destroy();candidate.loop?.destroy();candidate.body?.destroy();candidate.post?.destroy();candidate.lighting?.destroy();candidate.previewUniform?.destroy();destroyMesh(candidate.mesh);if(!candidate.mesh){for(const t of candidate.surface?.textures||[])t.destroy();for(const b of candidate.surface?.buffers||[])b.destroy();}candidate.wasm._world_clear();return candidate.audio?.destroy();};
 try{
  const w=candidate.wasm;onProgress(0,7);
  const scene=candidate.scene=await loadHallway(w,file,()=>{},{scripts:true,kind});
  if(kind==='hallway')for(let i=0;i<w._locator_count();i++)if(w.UTF8ToString(w._locator_name(i)).endsWith('|Connector_startDoor')){const p=w._locator_matrix(i)/4;candidate.connector=w.HEAPF32.slice(p,p+16);}
  onProgress(1,7);candidate.locomotion=await prepareLocomotion(w,file,()=>{});
  candidate.loop=await(kind==='start'?prepareOpening:prepareFirstLoop)(w,scene,file);
  onProgress(2,7);candidate.audio=await prepareAudio(file,()=>{},e=>{candidate.audioError=e;if(wasm===w)fail(e);});
  if(candidate.audio.languages.includes(preferences.language)&&candidate.audio.language!==preferences.language)await candidate.audio.setLanguage(preferences.language);
  await candidate.loop.attachAudio(candidate.audio);candidate.acoustics=new HallwayAcoustics(w,candidate.audio);candidate.acoustics.sources=new SceneSoundSources(w,candidate.audio);candidate.acoustics.locators=await prepareLocatorSounds(w,scene,file,candidate.audio);candidate.acoustics.lamp=await prepareLamp(w,scene,file,candidate.audio);
  onProgress(3,7);const qar=await new Qar(textureFile,w,file).open();const surface=candidate.surface=await uploadMaterials(device,texturedPipeline,qar,scene.groups,()=>{});
  surface.uvs=scene.uvs;surface.tangents=scene.tangents;candidate.loop.bindGroups(surface.groups);
  candidate.mesh=createMesh(scene.vertices,scene.indices,'Escena original',surface);
  onProgress(4,7);candidate.lighting=await lightingSystem.prepare(candidate.mesh,frameLayout,capturePipeline,scene.lights,scene.probes,scene.mirrorPlane,scene.baseLightingCounts);
  candidate.lighting.setFeatures($('shadows')?.checked??true,$('reflections')?.checked??true,$('indirect')?.checked??true,$('mirrors')?.checked??true);
  onProgress(5,7);candidate.body=await createPlayerBody(device,w,file,qar,texturedPipeline,()=>{});
  onProgress(6,7);candidate.post=await createPost(device,outputFormat,await preparePost(w,file,qar));onProgress(7,7);
  if(candidate.audioError)throw candidate.audioError;return candidate;
 }catch(e){await candidate.destroy();throw e;}
}
function installSession(c){
 wasm=c.wasm;walkScene=c.scene;firstLoop=c.loop;locomotion=c.locomotion;gameAudio=c.audio;acoustics=c.acoustics;mesh=c.mesh;sceneLighting=c.lighting;playerBody=c.body;post=c.post;spawn=c.scene.spawn;walking=true;resetPlayer();
 const names={Eng:'English',Spa:'Español',Fre:'Français',Ger:'Deutsch',Ita:'Italiano',Jpn:'日本語',Por:'Português'};
 $('subtitle-language').replaceChildren(...gameAudio.languages.map(code=>new Option(names[code]||code,code)));$('subtitle-language').value=gameAudio.language;gameAudio.setVolume(preferences.volume);
 if(firstLoop.opening){const view=firstLoop.update(0);camera=view.camera;yaw=view.yaw;pitch=view.pitch;cameraFov=view.fov;cameraBasis=view.basis;}
 status(firstLoop.opening?'Habitación inicial · despertar y salida original al pasillo':'Pasillo original · f010 → f005 → f020 → f030');
 document.documentElement.dataset.sessionResources=JSON.stringify({...device.resourceSnapshot(),audioContexts:1,session:true});
}
async function commitOpeningExit(view){
 const c=nextSession;if(!c||c.floor!==view.exit.destination||!c.connector)throw Error('El pasillo de destino no está preparado');
 const handoff=openingHandoff(view,c.connector,(...p)=>c.wasm._world_floor(...p));
 const {position}=handoff;
 const generation=sessionGeneration,oldAudio=gameAudio,playing=oldAudio?.active;
 if(!await primeStageAudio(c.audio,playing,()=>generation===sessionGeneration&&nextSession===c,()=>!!oldAudio?.active&&!menuPaused&&!document.hidden))return;
 c.previewUniform?.destroy();c.previewUniform=null;nextSession=null;
 // unloadWalk releases GPU resources synchronously; closing the old context must
 // not delay publishing the already-running destination or clear pointer input.
 const retirement=unloadWalk({transfer:true});installSession(c);transitioning=true;
 playerFeet=position;wasm._player_spawn(...position);yaw=handoff.yaw;pitch=handoff.pitch;camera=handoff.camera;cameraBasis=null;cameraFov=handoff.fov;locomotion.reset(yaw);locomotion.handCameraBack(camera,playerFeet);acoustics.reset();
 gameAudio.listener(camera,forward());acoustics.ambience.update(camera,.05);acoustics.sources.update(camera,.05);
 await retirement;transitioning=false;
 document.documentElement.dataset.stageTransfer='f000 → '+c.floor;
}
export async function loadWalk(file,textureFile,onProgress=()=>{},kind='start') {
 if(busy)return false;busy=true;$('error').textContent='';let candidate;
 try{
  candidate=await prepareSession(file,textureFile,onProgress,kind);await unloadWalk();installSession(candidate);
  if(kind==='start'){
   const generation=sessionGeneration,host=firstLoop;
   host.prepareDestination=async floor=>{
    if(floor!=='f010')throw Error('Destino original no implementado: '+floor);
    const notice=$('stage-loading');if(notice){notice.hidden=false;notice.disabled=true;}
    let next;
    try{next=await prepareSession(file,textureFile,(n,total)=>{if(notice&&generation===sessionGeneration)notice.textContent='Preparando pasillo · '+Math.round(n/total*100)+'%';},'hallway');}
    catch(error){if(notice&&generation===sessionGeneration){notice.disabled=false;notice.textContent='No se pudo cargar el pasillo. Reintentar';}throw error;}
    if(notice&&generation===sessionGeneration)notice.hidden=true;
    if(generation!==sessionGeneration){await next.destroy();throw Error('Sesión cancelada');}
    const halfTurn=new Float32Array([-1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1]);
    next.toRoom=multiply(multiply(host.connector,halfTurn),inverseRigid(next.connector));next.toHallway=inverseRigid(next.toRoom);
    next.previewUniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    next.previewBinding=device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:next.previewUniform}}]});
    next.lighting.setTransition(false);nextSession=next;
   };
   if($('stage-loading'))$('stage-loading').onclick=()=>host.retryPreparation();
   // Start when the user begins play, keeping the wizard's ready state truthful.
  }
  return true;
 }catch(e){if(candidate&&candidate.wasm!==wasm)await candidate.destroy();fail(e);return false;}finally{busy=false;}
}

export async function loadFiles(files) {
    if(busy)return; busy=true; revision++; $('error').textContent=''; $('files').disabled=true; $('models').disabled=true;
    try { modelList=await discoverModels(files,status);$('models').replaceChildren();
      modelList.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m.name;$('models').append(o);});
      status(modelList.length+' modelos encontrados. Selecciona uno para inspeccionarlo.');
    }catch(e){modelList=[];$('models').replaceChildren(new Option('Sin modelos disponibles'));fail(e);}
    finally{busy=false;$('files').disabled=false;$('models').disabled=false;}
    if(modelList.length) {
      const architecture = modelList.findIndex(m => /\/shsb_hous001\.fmdl$/i.test(m.name));
      const index = architecture < 0 ? 0 : architecture;
      $('models').value=String(index); return await loadModel(index);
    }
}

export const ready=init();
ready.catch(e=>{fail(e);status('Inicialización detenida. Consulta el mensaje de error.');});
export function pauseWalk(){inputActive=false;keys.clear();gameAudio?.pause();}

export async function createOriginalMenu(canvas,file,textureFile,onAction){const resources=await loadNativeUi(wasm,file,textureFile);resources.photo={collected:()=>!!(wasm._scene_photo_word()&0x100),collect:()=>firstLoop?.collectMenuPhoto?.()||false};resources.sounds=await decodeMenuSounds(await createMenuAudio(),file);return new NativeMenu(device,canvas,resources,onAction);}
