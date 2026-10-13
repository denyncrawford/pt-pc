import {Psarc,parseFpk,fpkEntry,unwrap} from './archives.js';
import {withEntry,withString} from './runtime.js';
import {loadFtex} from './materials.js';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export function exposureFor(ev,s){const points=s.ev.map((e,i)=>[e,s.add[i]]).sort((a,b)=>a[0]-b[0]);let comp=points[0][1];for(let i=1;i<3;i++){const [a,c]=points[i-1],[b,d]=points[i];if(ev>=a)comp=c+(d-c)*clamp((ev-a)/Math.max(b-a,1e-6));}return 2**(ev+s.compensation+comp);}
export function buildColorLut(t,s){
 if(t.width!==16||t.height!==16||t.depth!==16||t.format!==0)throw Error('LUT original incompatible');
 const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
 const out=new Uint8Array(256*16*4);
 for(let g=0;g<16;g++)for(let b=0;b<16;b++)for(let r=0;r<16;r++){
 const p=[r,g,b].map((x,i)=>clamp(x*s.scale[i],0,15)),lo=p.map(x=>Math.min(14,Math.floor(x))),f=p.map((x,i)=>x-lo[i]);
 for(let c=0;c<4;c++){let value=0;for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){let v=t.rgba[(((lo[2]+z)*16+lo[1]+y)*16+lo[0]+x)*4+c]/255;if(t.srgb&&c<3)v=decode(v);value+=v*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);}value=clamp(value);const v2=value*value,v3=v2*value;out[(g*256+b*16+r)*4+c]=Math.round(255*clamp(3*v2-2*v3+s.start*(v3-2*v2+value)+s.end*(v3-v2)));}
 }return out;
}
export async function preparePost(w,file,qar){
 w._post_reset();
 const archive=await new Psarc(file).open(),parameter=[...archive.names.keys()].find(n=>n.toLowerCase().endsWith('/shparametertables.lua'));
 if(!parameter)throw Error('Falta ShParameterTables.lua para exposición original');
 const resident=parseFpk(await archive.read('as/sh/level/common/resident.fpkd'));
 for(const e of resident.entries)if(e.name.endsWith('.fox2'))withEntry(w,fpkEntry(resident,e.name),e.name,(p,n)=>{if(!w._post_import(p,n,0))throw Error('Configuración residente inválida');});
 withEntry(w,unwrap(await archive.read(parameter)),parameter,(p,n)=>{if(!w._post_import(p,n,1))throw Error('Parámetros de iluminación inválidos');});
 const floors={};for(const floor of ['f000','f010','f005','f020']){const s=withString(w,floor,p=>JSON.parse(w.UTF8ToString(w._post_settings(p))));if(!s.luts?.common_saturation_a)throw Error('Falta LUT common_saturation_a');floors[floor]=s;}
 const s=floors.f010,path=s.luts.common_saturation_a,t=await loadFtex(qar,path,Infinity,{volume:true,strict:true});
 return {floors,lut:buildColorLut(t,s),path,parameter};
}
const common=`
struct Settings{range:vec4<f32>,comp:vec4<f32>,ev:vec4<f32>,bloom:vec4<f32>};
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var linearSampler:sampler;
@group(0) @binding(2) var bloomTex:texture_2d<f32>;
@group(0) @binding(3) var lut:texture_2d<f32>;
@group(0) @binding(4) var<uniform> settings:Settings;
@group(0) @binding(5) var<storage,read> state:array<f32>;
@group(0) @binding(7) var sceneDepth:texture_depth_2d;
@group(0) @binding(8) var aoTex:texture_2d<f32>;
struct Pass{value:vec4<f32>};@group(0) @binding(6) var<uniform> effectPass:Pass;
struct V{@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let p=vec2(f32((i<<1u)&2u),f32(i&2u));return V(vec4(p*vec2(2,-2)+vec2(-1,1),0,1),p);}
fn encode(x:vec3<f32>)->vec3<f32>{return select(1.055*pow(max(x,vec3(0)),vec3(1.0/2.4))-0.055,x*12.92,x<=vec3(0.0031308));}
// Native ssao.frag / ssao_blur.frag, with WebGPU forward depth converted to view metres.
fn linearDepth(uv:vec2<f32>)->f32{let size=textureDimensions(sceneDepth);let p=clamp(vec2<i32>(uv*vec2<f32>(size)),vec2(0),vec2<i32>(size)-1);let d=textureLoad(sceneDepth,p,0);return 40.0/(2000.0-d*1999.98);}
fn pair(z:f32,za:f32,zb:f32,k:f32,md:f32,falloff:f32)->f32{let da=z-za;let db=z-zb;let a=clamp(da*k+.5,0.0,1.0);let b=clamp(db*k+.5,0.0,1.0);let wa=clamp(falloff*(md-da),0.0,1.0);let wb=clamp(falloff*(md-db),0.0,1.0);let fa=wa*(.5-a)+.5;let fb=wb*(.5-b)+.5;return wa*(a-fb)+fb+wb*(b-fa)+fa;}
@fragment fn occlusion(v:V)->@location(0) vec4<f32>{
 let size=textureDimensions(sceneDepth);let p=vec2<u32>(v.position.xy);if(textureLoad(sceneDepth,p,0)>=1.0){return vec4(1);}
 let z=linearDepth(v.uv);let hx=p.x&3u;let hy=p.y&3u;let angle=f32((hx*7u+hy*13u)&15u)*(6.2831853/16.0)+f32(hy)*.37;let r=vec2(cos(angle),sin(angle));
 let aspect=f32(size.y)/f32(size.x);let ra=vec2(aspect,1)*min(.07,3.0/z);let rb=vec2(aspect,1)*min(.07,1.0/z);
 let dirs=array<vec2<f32>,3>(vec2(.216506*r.x-.125*r.y,.125*r.x+.216506*r.y),vec2(-.433013*r.x-.25*r.y,.25*r.x-.433013*r.y),vec2(r.y,-r.x)*.75);
 let weights=array<f32,3>(.156523,.176937,.132698);let ks=array<f32,3>(.5164734,.5775443,.75592875);var inner=.0338425;var outer=.0338425;
 for(var i=0u;i<3u;i++){inner+=weights[i]*pair(z,linearDepth(v.uv+dirs[i]*ra),linearDepth(v.uv-dirs[i]*ra),ks[i],1,1);outer+=weights[i]*pair(z,linearDepth(v.uv+dirs[i]*rb),linearDepth(v.uv-dirs[i]*rb),ks[i],4,.25);}
 let o=clamp(clamp(2*inner-1,0.0,1.0)+clamp(2*outer-1,0.0,1.0),0.0,1.0);let strength=clamp((z-.85)/5,0.0,1.0)*clamp((100-z)/150,0.0,1.0);return vec4(1-strength*o);
}
@fragment fn occlusionBlur(v:V)->@location(0) vec4<f32>{let size=vec2<i32>(textureDimensions(source));var sum=0.0;for(var y=-2;y<2;y++){for(var x=-2;x<2;x++){sum+=textureLoad(source,clamp(vec2<i32>(v.position.xy)+vec2(x,y),vec2(0),size-1),0).r;}}return vec4(pow(clamp(sum/16,0.0,1.0),1.0/.45));}
@fragment fn occluded(v:V)->@location(0) vec4<f32>{let p=vec2<i32>(v.position.xy);return vec4(textureLoad(source,p,0).rgb*textureLoad(aoTex,p,0).r,1);}
@fragment fn bright(v:V)->@location(0) vec4<f32>{let dim=textureDimensions(source);let p=min(vec2<u32>(v.uv*vec2<f32>(dim)),dim-1u);let x=clamp(textureLoad(source,p,0).rgb*state[1],vec3(0),vec3(1));let l=dot(x,vec3(.2126,.7152,.0722));let e=clamp(settings.bloom.y,1.0,3.99999);let w=mix(pow(l,floor(e)),pow(l,floor(e)+1),fract(e));return vec4(clamp(x*w,vec3(0),vec3(1)),1);}
fn blur(uv:vec2<f32>)->vec4<f32>{let o=vec2(effectPass.value.x)/vec2<f32>(textureDimensions(source));let c=textureSampleLevel(source,linearSampler,uv+vec2(-o.x,-o.y),0)+textureSampleLevel(source,linearSampler,uv+vec2(o.x,-o.y),0)+textureSampleLevel(source,linearSampler,uv+vec2(-o.x,o.y),0)+textureSampleLevel(source,linearSampler,uv+o,0);return clamp(c*(.25*effectPass.value.y),vec4(0),vec4(1));}
@fragment fn kawase(v:V)->@location(0) vec4<f32>{return blur(v.uv);}
@fragment fn add(v:V)->@location(0) vec4<f32>{return textureSampleLevel(source,linearSampler,v.uv,0)*effectPass.value.z;}
@fragment fn compose(v:V)->@location(0) vec4<f32>{let x=encode(clamp(textureSampleLevel(source,linearSampler,v.uv,0).rgb*state[1],vec3(0),vec3(1)));let b=min(vec3(.5),textureSampleLevel(bloomTex,linearSampler,v.uv+.5/vec2<f32>(textureDimensions(bloomTex)),0).rgb);let r=clamp(x*x+b-x*x*b,vec3(0),vec3(1));let c=clamp(r*inverseSqrt(max(vec3(1.0/512.0),r)),vec3(0),vec3(1));let slice=floor(15*c.b);let uv=vec2(c.r*(15.0/256.0)+1.0/512.0+slice/16.0,c.g*(15.0/16.0)+1.0/32.0);let a=textureSampleLevel(lut,linearSampler,uv,0).rgb;let z=textureSampleLevel(lut,linearSampler,uv+vec2(1.0/16.0,0),0).rgb;return vec4(pow(max(mix(a,z,15*c.b-slice),vec3(0)),vec3(1.0/max(settings.comp.w,.1))),1);}
`;
const reflectionShader=`// reflect_make.frag: non-temporal original march, 16 coarse steps and 6 refinements.
@group(0) @binding(9) var normals:texture_2d<f32>;
struct Camera{right:vec4<f32>,up:vec4<f32>,forward:vec4<f32>};
@group(0) @binding(10) var<uniform> camera:Camera;
@group(0) @binding(11) var reflectionHits:texture_2d<f32>;
fn viewNormal(n:vec3<f32>)->vec3<f32>{return vec3(dot(n,camera.right.xyz),dot(n,camera.up.xyz),dot(n,camera.forward.xyz));}
fn project(p:vec3<f32>)->vec2<f32>{return p.xy/(vec2(camera.right.w,camera.up.w)*p.z);}
fn screen(ndc:vec2<f32>)->vec2<f32>{return ndc*vec2(.5,-.5)+.5;}
fn outside(uv:vec2<f32>)->bool{return any(uv<vec2(0))||any(uv>vec2(1));}
@fragment fn reflectionMake(v:V)->@location(0) vec4<f32>{
 let uv=v.uv;let normal=textureLoad(normals,vec2<i32>(v.position.xy),0);if(abs(normal.y)<.9||camera.forward.w<.5){return vec4(0);}
 let z=linearDepth(uv);if(z>1999.99){return vec4(0);}let plane=viewNormal(vec3(0,1,0));
 let P=vec3((uv*vec2(2,-2)+vec2(-1,1))*vec2(camera.right.w,camera.up.w)*z,z);let R=reflect(normalize(P),plane);let P2=P+R;if(P2.z<=0.0){return vec4(0);}
 let start=project(P);let delta=project(P2)-start;let size=vec2<f32>(textureDimensions(sceneDepth));let scale=1.0/max(length(.4*vec2(1080.0*size.x/size.y,1080)*delta),1e-8);let stride=delta*scale;
 let invZ=1.0/P.z;let stepZ=(1.0/P2.z-invZ)*scale;var terminated=false;var previous=false;var hit=-1;
 for(var k=0;k<16;k++){let s=1.0+25.0*f32(k);let q=screen(start+s*stride);let sz=linearDepth(q);terminated=terminated||previous||sz>1999.99||outside(q);let behind=1.0/(stepZ*s+invZ)>sz;if(k>0&&behind&&!terminated&&hit<0){hit=k-1;}previous=behind;}
 if(hit<0){return vec4(0);}var lo=1.0+25.0*f32(hit);var hi=lo+25;var errorBest=999.0;var stepBest=0.0;var uvBest=vec2(0.0);var invalid=false;
 for(var i=0;i<6;i++){let mid=(lo+hi)*.5;let q=screen(start+mid*stride);let mz=linearDepth(q);let rz=1.0/(stepZ*mid+invZ);invalid=invalid||outside(q)||mz>1999.99;let error=abs(rz-mz);if(error<errorBest){errorBest=error;stepBest=mid;uvBest=q;}if(rz>mz){hi=mid;}else{lo=mid;}}
 if(invalid){return vec4(0);}let travel=stepBest*scale*length(R);let sf=clamp(stepBest*.0026595744,0.0,1.0);let confidence=min(1.0-clamp(sqrt(dot(P,P)+1.0)*.002+travel*.002,0.0,1.0),min(1-sf*sf,1-clamp(travel*.02,0.0,1.0)))*(1-clamp(errorBest*10,0.0,1.0));
 return vec4(clamp(.5*(uvBest-uv)+.5,vec2(0),vec2(1)),confidence,1);
}
fn decode(c:vec3<f32>)->vec3<f32>{return select(pow((c+.055)/1.055,vec3(2.4)),c/12.92,c<=vec3(.04045));}
@fragment fn reflectionBlend(v:V)->@location(0) vec4<f32>{
 let base=textureSampleLevel(source,linearSampler,v.uv,0);let n=textureLoad(normals,vec2<i32>(v.position.xy),0);if(n.y<.9||camera.forward.w<.5){return base;}
 let N=viewNormal(n.xyz);let plane=viewNormal(vec3(0,1,0));let center=textureSampleLevel(reflectionHits,linearSampler,v.uv,0);let tilt=(N.xy-plane.xy)*center.z*center.w;
 let r=textureSampleLevel(reflectionHits,linearSampler,v.uv+.15*vec2(-tilt.x,tilt.y),0);if(outside(r.xy)||r.w<=0.0){return base;}
 let hitColor=textureSampleLevel(source,linearSampler,v.uv+2*r.xy-1,0).rgb;
 // game.cpp: non-ending REFLECT_MAP scale=2, bias=0, edge=false.
 let strength=clamp(2*pow(abs(1-n.w),4)*max(1.0,min(4.0,N.z*3+2)),0.0,1.0);
 let amount=strength*clamp(n.y,0.0,1.0)*r.z*r.w*(1-abs(2*v.uv.x-1));let exposure=max(state[1],1e-8);
 return vec4(decode(mix(encode(min(base.rgb*exposure,vec3(1))),encode(min(hitColor*exposure,vec3(1))),amount))/exposure,base.a);
}
`;
const meter=`
struct Settings{range:vec4<f32>,comp:vec4<f32>,ev:vec4<f32>,bloom:vec4<f32>};
@group(0) @binding(0) var diffuse:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> partial:array<vec2<f32>>;
@group(0) @binding(2) var<storage,read_write> state:array<f32>;
@group(0) @binding(3) var<uniform> settings:Settings;
var<workgroup> sum:array<vec2<f32>,256>;
@compute @workgroup_size(16,16) fn measure(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) i:u32,@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let dim=textureDimensions(diffuse);var a=vec2(0.0);for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){let p=id.xy*2u+vec2(x,y);if(all(p<dim)){let c=textureLoad(diffuse,p,0);if(c.a>0.0){a+=vec2(max(0.0,dot(c.rgb,vec3(.2126,.7152,.0722))),1);}}}}sum[i]=a;workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(i<stride){sum[i]+=sum[i+stride];}workgroupBarrier();}if(i==0u){partial[group.y*groups.x+group.x]=sum[0];}}
@compute @workgroup_size(1) fn adapt(){let dim=textureDimensions(diffuse);let n=((dim.x+31u)/32u)*((dim.y+31u)/32u);var total=vec2(0.0);for(var i=0u;i<n;i++){total+=partial[i];}let raw=total.x/max(total.y,1.0);var ev=clamp(state[0],settings.range.x,settings.range.y);let desiredEV=clamp(ev+.5*(log2(settings.range.w+.001)-log2(raw*exp2(ev)+.001)),settings.range.x,settings.range.y);if(state[2]<.5){for(var i=0;i<64;i++){ev=clamp(ev+.5*(log2(settings.range.w+.001)-log2(raw*exp2(ev)+.001)),settings.range.x,settings.range.y);}}else{let diff=desiredEV-ev;let step=diff*(1-pow(.98,60*settings.bloom.w))*1.6*min(1.0,abs(diff));ev+=clamp(step,-abs(diff),abs(diff));}var comp=settings.comp.x;if(ev<=settings.ev.z){comp=settings.comp.z;}else if(ev<=settings.ev.y){comp=mix(settings.comp.z,settings.comp.y,(ev-settings.ev.z)/max(settings.ev.y-settings.ev.z,1e-6));}else if(ev<settings.ev.x){comp=mix(settings.comp.y,settings.comp.x,(ev-settings.ev.y)/max(settings.ev.x-settings.ev.y,1e-6));}state[0]=ev;state[1]=exp2(ev+settings.range.z+comp);state[2]=1;state[3]=raw;}
`;
export async function createPost(device,format,resources){
 const keep=[],targets=[];let width=0,height=0,hdr,diffuse,a,b,sum,partial,groups,ao,aoBlur,shaded,normal,hits,reflected;const usage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;
 const tex=(w,h,format='rgba16float')=>{const t=device.createTexture({size:[w,h],format,usage});targets.push(t);return t;};
 const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});keep.push(b);return b;};
 const cameraBuffer=buffer(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
 const params=buffer(64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),state=buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(state,0,new Float32Array([0,.012,0,0]));
 const lut=device.createTexture({size:[256,16],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});keep.push(lut);device.queue.writeTexture({texture:lut},resources.lut,{bytesPerRow:1024},[256,16]);const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
 const layout=device.createBindGroupLayout({entries:[...[0,2,3,8,9,11].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{}})),{binding:10,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:6,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
 try{
 const module=device.createShaderModule({code:common+reflectionShader}),pipelines={};const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.lineNum+': '+m.message).join('\n')); for(const name of ['bright','kawase','add','compose','occlusion','occlusionBlur','occluded','reflectionMake','reflectionBlend'])pipelines[name]=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:name,targets:[{format:name==='compose'?format:(name==='occluded'||name.startsWith('reflection'))?'rgba16float':name.startsWith('occlusion')?'r8unorm':'rgba8unorm-srgb',...(name==='add'?{blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}:{})}]}});
 const ml=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{}},...[1,2].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]}),mm=device.createShaderModule({code:meter}),compute={};const ce=(await mm.getCompilationInfo()).messages.filter(m=>m.type==='error');if(ce.length)throw Error(ce.map(m=>m.lineNum+': '+m.message).join('\n'));for(const entry of ['measure','adapt'])compute[entry]=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[ml]}),compute:{module:mm,entryPoint:entry}});
 const passes=[];for(let i=0;i<64;i++){const p=buffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);passes.push(p);}const zero=buffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(zero,0,new Float32Array([0,1,1,0]));
 let destroyed=false;
 return {brightness:1,resize(w,h){if(width===w&&height===h)return;width=w;height=h;for(const t of targets)t.destroy();targets.length=0;partial?.destroy();hdr=tex(w,h);diffuse=tex(w,h);ao=tex(w,h,'r8unorm');aoBlur=tex(w,h,'r8unorm');shaded=tex(w,h);normal=tex(w,h);hits=tex(w,h);reflected=tex(w,h);a=tex(Math.max(1,Math.floor(w/4)),Math.max(1,Math.floor(h/4)),'rgba8unorm-srgb');b=tex(Math.max(1,Math.floor(w/4)),Math.max(1,Math.floor(h/4)),'rgba8unorm-srgb');sum=tex(Math.max(1,Math.floor(w/4)),Math.max(1,Math.floor(h/4)),'rgba8unorm-srgb');groups=[Math.ceil(w/32),Math.ceil(h/32)];partial=device.createBuffer({size:groups[0]*groups[1]*8,usage:GPUBufferUsage.STORAGE});},get hdr(){return hdr.createView();},get normal(){return normal.createView();},get diffuse(){return diffuse.createView();},reset(){device.queue.writeBuffer(state,0,new Float32Array([0,.012,0,0]));},render(encoder,destination,dt,floor,depth,frame,reflections=true,forward){
 const r=[frame[0],frame[4],frame[8]],u=[frame[1],frame[5],frame[9]],rx=Math.hypot(...r),uy=Math.hypot(...u);device.queue.writeBuffer(cameraBuffer,0,new Float32Array([...r.map(x=>x/rx),1/rx,...u.map(x=>x/uy),1/uy,...frame.slice(20,23),Number(reflections)]));const s=resources.floors[floor]||resources.floors.f010;device.queue.writeBuffer(params,0,new Float32Array([s.min,s.max,s.compensation,s.key,...s.add,this.brightness,...s.ev,0,s.weight,s.extraction,s.size,dt]));const mg=device.createBindGroup({layout:ml,entries:[{binding:0,resource:diffuse.createView()},{binding:1,resource:{buffer:partial}},{binding:2,resource:{buffer:state}},{binding:3,resource:{buffer:params}}]});for(const name of ['measure','adapt']){const p=encoder.beginComputePass();p.setPipeline(compute[name]);p.setBindGroup(0,mg);p.dispatchWorkgroups(...(name==='measure'?groups:[1]));p.end();}
 const draw=(name,source,dest,pass=zero,load=false)=>{const p=encoder.beginRenderPass({colorAttachments:[{view:dest,loadOp:load?'load':'clear',storeOp:'store',clearValue:[0,0,0,0]}]});p.setPipeline(pipelines[name]);p.setBindGroup(0,device.createBindGroup({layout,entries:[{binding:0,resource:source.createView()},{binding:1,resource:sampler},{binding:2,resource:(name==='compose'?sum:lut).createView()},{binding:3,resource:lut.createView()},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:state}},{binding:6,resource:{buffer:pass}},{binding:7,resource:depth.createView()},{binding:8,resource:(name==='occluded'?aoBlur:lut).createView()},{binding:9,resource:normal.createView()},{binding:10,resource:{buffer:cameraBuffer}},{binding:11,resource:(name==='reflectionBlend'?hits:lut).createView()}]}));p.draw(3);p.end();};
 draw('occlusion',lut,ao.createView());draw('occlusionBlur',ao,aoBlur.createView());draw('occluded',hdr,shaded.createView());forward?.(shaded.createView());draw('reflectionMake',lut,hits.createView());draw('reflectionBlend',shaded,reflected.createView());draw('bright',reflected,a.createView());const n=clamp(Math.floor(s.size*10),1,64);for(let i=0;i<n;i++){device.queue.writeBuffer(passes[i],0,new Float32Array([i+.5,i===0?s.weight:1,s.weight/n,0]));draw('kawase',a,b.createView(),passes[i]);draw('kawase',b,a.createView(),passes[i]);draw('add',a,sum.createView(),passes[i],i>0);}draw('compose',reflected,destination);
 },destroy(){if(destroyed)return;destroyed=true;for(const t of targets)t.destroy();partial?.destroy();for(const r of keep)r.destroy();}};
 }catch(e){for(const t of targets)t.destroy();partial?.destroy();for(const r of keep)r.destroy();throw e;}
}
