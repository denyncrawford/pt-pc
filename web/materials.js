import {makeLightingLuts,materialTableRow} from './material-shading.js';
// FMDL material tables and QAR/FTEX layout mirror the native asset readers.
import {readSlice,MAX_ENTRY,Psarc} from './archives.js';
function check(v,m='Recurso de textura inválido'){if(!v)throw Error(m);}
export function readMaterials(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=p=>d.getUint16(p,true),u32=p=>d.getUint32(p,true);
 const f=new Map(),b=new Map(),table=u32(8),fc=u32(32),bc=u32(36);check(fc<=256&&bc<=256);
 for(let i=0;i<fc;i++){const p=table+i*8;f.set(bytes[p],{offset:u32(40)+u32(p+4),count:bytes[p+1]*65536+u16(p+2)});}
 for(let i=0;i<bc;i++){const p=table+fc*8+i*12;b.set(u32(p),u32(48)+u32(p+4));}
 const tableAt=(k,i,stride)=>{const t=f.get(k);check(t&&i<t.count);return t.offset+i*stride;};
 const strings=[];for(let i=0;i<(f.get(12)?.count||0);i++){const p=tableAt(12,i,8),start=b.get(3)+u32(p+4),length=u16(p+2);check(start+length<=bytes.length);strings.push(new TextDecoder().decode(bytes.subarray(start,start+length)));}
 const str=i=>strings[i]||'',materials=[];
 for(let i=0;i<(f.get(4)?.count||0);i++){
  const p=tableAt(4,i,16),m={name:str(u16(p)),textures:{},vectors:{}};
  const sh=tableAt(8,u16(p+4),4);m.shader=str(u16(sh));m.technique=str(u16(sh+2));
  for(let j=0;j<bytes[p+6];j++){const q=tableAt(7,u16(p+8)+j,4),t=tableAt(6,u16(q+2),4);m.textures[str(u16(q))]=str(u16(t+2))+str(u16(t)).split('.')[0];}
  for(let j=0;j<bytes[p+7];j++){const q=tableAt(7,u16(p+10)+j,4),v=b.get(0)+u16(q+2)*16;m.vectors[str(u16(q))]=Array.from({length:4},(_,k)=>d.getFloat32(v+k*4,true));}
  materials.push(m);
 }
 let first=0;const groups=[];for(let i=0;i<(f.get(3)?.count||0);i++){const p=tableAt(3,i,48),count=u32(p+20);groups.push({first,count,flags:u32(p),material:materials[u16(p+4)]});first+=count;}
 return groups;
}
export class Qar {
 constructor(file,wasm,sceneFile){this.sceneFile=sceneFile;this.file=file;this.wasm=wasm;this.entries=new Map();}
 async open(){const footer=await readSlice(this.file,this.file.size-36,36),d=new DataView(footer.buffer);check(d.getUint16(22,true)===0x7161,'QAR sin índice válido');const count=d.getUint32(16,true);check(count<=1000000);const bytes=await readSlice(this.file,d.getUint32(24,true)*16,count*16),t=new DataView(bytes.buffer);for(let i=0;i<count;i++){const p=i*16;this.entries.set(t.getBigUint64(p,true),[t.getUint32(p+8,true)*16,t.getUint32(p+12,true)]);}return this;}
 async read(name){const b=new TextEncoder().encode(name+'\0'),p=this.wasm._malloc(b.length);let key;try{this.wasm.HEAPU8.set(b,p);key=BigInt.asUintN(64,this.wasm._texture_pathcode(p));}finally{this.wasm._free(p);}const entry=this.entries.get(key);if(entry)return readSlice(this.file,...entry);
 if(this.sceneFile){if(!this.fallback){this.fallback=new Map();const a=await new Psarc(this.sceneFile).open();for(const n of a.names.keys())if(/(\/hallway\/pt14_hallway|\/common\/resident|\/chara\/player\/game_object\/plparts_normal)\.pftxs$/.test(n)){for(const [path,bytes] of parsePftxs(await a.read(n)))this.fallback.set(path,bytes);}}if(this.fallback.has(name))return this.fallback.get(name);}
 throw Error('Falta textura: '+name);}
}
async function inflate(bytes,expected){const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),out=new Uint8Array(expected);let n=0;try{while(true){const r=await reader.read();if(r.done)break;check(n+r.value.length<=expected);out.set(r.value,n);n+=r.value.length;}}finally{await reader.cancel();}check(n===expected);return out;}
export async function loadFtex(qar,stem,maxSize=1024,options={}){
 const h=await qar.read(stem+'.ftex'),d=new DataView(h.buffer,h.byteOffset,h.byteLength);check(new TextDecoder().decode(h.subarray(0,4))==='FTEX');
 const format=d.getUint16(8,true),width=d.getUint16(10,true),height=d.getUint16(12,true),flags=d.getUint32(28,true);check(width&&height&&!(flags&4)&&(options.volume||d.getUint16(14,true)<=1));
 let level=options.level??0;while(Math.max(width>>level,height>>level)>maxSize&&level+1<h[16])level++;
 const e=64+level*16,offset=d.getUint32(e,true),size=d.getUint32(e+4,true),file=h[e+13],chunks=d.getUint16(e+14,true);check(size>0&&size<=MAX_ENTRY);
 let source;try{source=file?await qar.read(stem+'.'+file+'.ftexs'):h;}catch(error){if(!options.strict&&error.message.startsWith('Falta textura:')&&level+1<h[16])return loadFtex(qar,stem,Math.max(1,Math.max(width,height)>>(level+1)));throw error;}let data;
 if(flags&1){data=new Uint8Array(size);let written=0;const sd=new DataView(source.buffer,source.byteOffset,source.byteLength);
  for(let i=0;i<chunks;i++){const p=offset+i*8,stored=sd.getUint16(p,true),unpacked=sd.getUint16(p+2,true)||65536,field=sd.getUint32(p+4,true),start=offset+(field&0x7fffffff);check(start+stored<=source.length&&written+unpacked<=size);const bytes=source.subarray(start,start+stored);const chunk=field&0x80000000?bytes:await inflate(bytes,unpacked);check(chunk.length===unpacked);data.set(chunk,written);written+=unpacked;}check(written===size);
 }else{check(offset+size<=source.length);data=source.slice(offset,offset+size);}
 const w=Math.max(1,width>>level),ht=Math.max(1,height>>level);return {width:w,height:ht,depth:Math.max(1,d.getUint16(14,true)>>level),format,srgb:!!(flags&2),level,mipCount:h[16],data,rgba:options.raw?null:decodeBlocks(data,w,ht*(options.volume?Math.max(1,d.getUint16(14,true)>>level):1),format)};
}
function alpha(b,p){const a=[b[p],b[p+1]];if(a[0]>a[1]){for(let i=1;i<7;i++)a.push(((7-i)*a[0]+i*a[1])/7);}else{for(let i=1;i<5;i++)a.push(((5-i)*a[0]+i*a[1])/5);a.push(0,255);}let bits=0n;for(let i=0;i<6;i++)bits|=BigInt(b[p+2+i])<<BigInt(i*8);return Array.from({length:16},(_,i)=>a[Number((bits>>BigInt(i*3))&7n)]);}
export function decodeBlocks(b,w,h,format){
 check(w>0&&h>0&&w<=4096&&h<=4096);const out=new Uint8Array(w*h*4);
 if(format===0){check(b.length>=out.length);for(let i=0;i<out.length;i+=4)out.set([b[i+2],b[i+1],b[i],b[i+3]],i);return out;}
 if(format===1){check(b.length>=w*h);for(let i=0;i<w*h;i++)out.set([b[i],b[i],b[i],255],i*4);return out;}
 check([2,3,4,5].includes(format),'Formato FTEX no compatible: '+format);
 const stride=format===2?8:16,bw=Math.ceil(w/4),bh=Math.ceil(h/4);check(b.length>=bw*bh*stride);
 for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){
  const p=(y*bw+x)*stride;let colors,indices=0,a,green;
  if(format===5){a=alpha(b,p);green=alpha(b,p+8);}else{
   const q=p+(format===2?0:8),c0=b[q]|b[q+1]<<8,c1=b[q+2]|b[q+3]<<8;
   const rgb=c=>[((c>>11)&31)*255/31,((c>>5)&63)*255/63,(c&31)*255/31,255];colors=[rgb(c0),rgb(c1)];
   colors.push(colors[0].map((v,i)=>i===3?255:(c0>c1||format!==2?(2*v+colors[1][i])/3:(v+colors[1][i])/2)));
   colors.push(colors[0].map((v,i)=>c0>c1||format!==2?(i===3?255:(v+2*colors[1][i])/3):0));
   indices=(b[q+4]|b[q+5]<<8|b[q+6]<<16|b[q+7]<<24)>>>0;if(format===4)a=alpha(b,p);
  }
  for(let i=0;i<16;i++){const px=x*4+i%4,py=y*4+(i>>2);if(px>=w||py>=h)continue;let c=format===5?[a[i],green[i],255,255]:colors[(indices>>>(i*2))&3].slice();if(format===3)c[3]=((b[p+(i>>1)]>>((i&1)*4))&15)*17;if(format===4)c[3]=a[i];out.set(c,(py*w+px)*4);}
 }return out;
}
// Values are authored FMDL vectors; shading remains the browser forward approximation.
export function materialUniforms(g,table){
 const m=g.material||{},v=m.vectors||{},scalar=(key,fallback)=>v[key]?.[0]??fallback;
 const constant=m.shader?.startsWith('fox_3dfw_constant'),native=!!v.MatParamIndex_0;
 const hair=m.shader==='fox_3ddf_hair',trans=/_(Skin|Eye|Hair|Translucent)/.test(m.technique||'');
 return new Float32Array([
  (g.flags&128)?((g.flags&16384)?64/255:(g.player?-1:0.12)):0,/3ddc/.test(m.shader)?1:0,Number(!!g.mirror),Number(trans),
  ...(constant?(v.SelfColor||[1,1,1,1]):(v.Incidence_Color||[0,0,0,0])),
  constant?scalar('SelfColorIntensity',1):scalar('Incidence_Roughness',1),Number(hair),scalar('Anistropic_Diffusion',0),scalar('HairShiftScale',0),
  scalar('URepeat_UV',1),scalar('VRepeat_UV',1),constant?-1:(native?(m.shader==='fox_3ddf_eye'?2:1):0),scalar('HeightScale',0),
  ...materialTableRow(table,scalar('MatParamIndex_0',0)),
  scalar('SubNormal_Blend',0),scalar('URepeat_UV',1),scalar('VRepeat_UV',1),Number(!!m.textures?.SubNormalMap_Tex_LIN||Object.keys(m.textures||{}).some(k=>k.startsWith('SubNormalMap_Tex'))),
  scalar('MinRoughness',1),scalar('RoughnessFrequency',1),Number(!!v.MinRoughness),0,
  ...[1,2,3].flatMap(i=>materialTableRow(table,i<Number((m.technique||'').match(/_([234])MT/)?.[1]||1)?scalar('MatParamIndex_'+i,0):0)),
  Number((m.technique||'').match(/_([234])MT/)?.[1]||1),0,0,0
 ]);
}
export const materialWGSL=`struct Material {flags:vec4<f32>,incidence:vec4<f32>,surface:vec4<f32>,repeat:vec4<f32>,tableColor:vec4<f32>,tableParams:vec4<f32>,subnormal:vec4<f32>,micro:vec4<f32>,color1:vec4<f32>,params1:vec4<f32>,color2:vec4<f32>,params2:vec4<f32>,color3:vec4<f32>,params3:vec4<f32>,multi:vec4<f32>};var<private> selectedColor:vec4<f32>;var<private> selectedParams:vec4<f32>;`;
export async function uploadMaterials(device,pipeline,qar,groups,progress){
 const buffers=[],textures=[],cache=new Map(),normalAlpha=new Map(),materials=new Map(),missing=[];let bytes=0,table=null,tableFallback=false;
 // Preserve authored dimensions; compression and mip chains control transfer and sampling costs.
 const bc=device.features?.has('texture-compression-bc');
 const sampler=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
 const make=(rgba,width=1,height=1,srgb=false)=>{bytes+=width*height*4;const t=device.createTexture({size:[width,height],format:srgb?'rgba8unorm-srgb':'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});textures.push(t);device.queue.writeTexture({texture:t},rgba,{bytesPerRow:width*4},[width,height]);return t.createView();};
 try{
 if(groups.some(g=>g.material?.vectors?.MatParamIndex_0)){try{table=await loadFtex(qar,'/Assets/fox/effect/gr_pic/materials_alp_rgba32_nomip_nrt');}catch(e){if(!e.message.startsWith('Falta textura:'))throw e;tableFallback=true;progress('Tabla de materiales ausente: fallback nativo activo');}}
 bytes+=36864;
 const lut=makeLightingLuts(),lutSampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
 const fresnel=device.createTexture({size:[64,64],format:'r8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});textures.push(fresnel);device.queue.writeTexture({texture:fresnel},lut.fresnel,{bytesPerRow:64},[64,64]);
 const ndf=device.createTexture({dimension:'3d',size:[64,16,16],format:'rg8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});textures.push(ndf);device.queue.writeTexture({texture:ndf},lut.ndf,{bytesPerRow:128,rowsPerImage:16},[64,16,16]);
 const defaults=[make(new Uint8Array([210,210,210,255]),1,1,true),make(new Uint8Array([128,128,255,255])),make(new Uint8Array([25,25,25,255])),make(new Uint8Array([128,128,128,255])),make(new Uint8Array([0,0,0,255])),make(new Uint8Array([255,255,255,255])),make(new Uint8Array([0,0,0,255])),make(new Uint8Array([0,0,0,255]))];
 async function texture(material,prefix,kind){
 const subnormal=Object.keys(material?.textures||{}).some(k=>k.startsWith('SubNormalMap_Tex'));
 if(subnormal&&kind===3)prefix='SubNormalMask_Tex';
 if(subnormal&&kind===4)prefix='SubNormalMap_Tex';
 if(kind===6&&/_[234]MT/.test(material?.technique||''))prefix='MatParamMap_Tex';
 const masked=kind===0&&material?.shader==='fox_3dfw_constant'&&Object.keys(material.textures||{}).some(k=>k.startsWith('Mask_Tex'));
 if(masked)prefix='Mask_Tex';
 const path=Object.entries(material?.textures||{}).find(([k])=>k.startsWith(prefix))?.[1];
 if(!path)return subnormal&&kind===3?defaults[5]:defaults[kind];
 const key=kind+path;if(cache.has(key))return cache.get(key);
 progress('Textura original: '+path.split('/').pop());
 // Cache only this texture's streams while uploading its authored mip chain.
 const streams=new Map(),source={read:async name=>{if(!streams.has(name))streams.set(name,qar.read(name));return streams.get(name);}};
 let t;try{t=await loadFtex(source,path,Infinity,{raw:true,strict:true});}catch(e){if(!e.message.startsWith('Falta textura:'))throw e;missing.push(e.message);cache.set(key,defaults[kind]);return defaults[kind];}
 check(Math.max(t.width,t.height)<=(device.limits?.maxTextureDimension2D??8192),'Textura excede el tamaño admitido por la GPU: '+path);
 if(kind===1)normalAlpha.set(path,t.format===4);
 const srgb=kind===0&&!masked&&t.srgb;
 const compressed=bc&&[2,3,4,5].includes(t.format)&&t.width%4===0&&t.height%4===0;
 const format=compressed?({2:'bc1-rgba-unorm',3:'bc2-rgba-unorm',4:'bc3-rgba-unorm',5:'bc5-rg-unorm'}[t.format]+(srgb&&t.format!==5?'-srgb':'')):(srgb?'rgba8unorm-srgb':'rgba8unorm');
 const texture=device.createTexture({size:[t.width,t.height],mipLevelCount:t.mipCount,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});textures.push(texture);
 for(let level=0;level<t.mipCount;level++){
 const mip=level?await loadFtex(source,path,Infinity,{level,raw:true,strict:true}):t;
 let data,w=mip.width,h=mip.height,row;
 if(compressed){data=mip.data;row=Math.ceil(w/4)*(t.format===2?8:16);w=Math.ceil(w/4)*4;h=Math.ceil(h/4)*4;}
 else{data=decodeBlocks(mip.data,w,h,t.format);row=w*4;}
 bytes+=data.byteLength;device.queue.writeTexture({texture,mipLevel:level},data,{bytesPerRow:row},[w,h]);
 }
 const view=texture.createView();cache.set(key,view);return view;
 }

 const result=[];
 for(const g of groups){const key=JSON.stringify([g.material,g.flags,g.mirror]);let binding=materials.get(key);if(!binding){const views=[];for(const [i,prefix] of ['Base_Tex','NormalMap_Tex','SpecularMap_Tex','Translucent_Tex','Shift_Tex','Base_Tex2','LensHeight_Tex','ViewReflection_Tex'].entries())views.push(await texture(g.material,prefix,i));const params=device.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(params);const values=materialUniforms(g,table);values[31]=Number(!!normalAlpha.get(Object.entries(g.material?.textures||{}).find(([k])=>k.startsWith('NormalMap_Tex'))?.[1]));device.queue.writeBuffer(params,0,values);binding=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:sampler},...views.map((resource,i)=>({binding:i<3?i+1:i+2,resource})),{binding:4,resource:{buffer:params}},{binding:10,resource:fresnel.createView()},{binding:11,resource:ndf.createView()},{binding:12,resource:lutSampler}]});materials.set(key,binding);}result.push({...g,binding,emissive:g.material?.shader?.startsWith('fox_3dfw_constant'),decal:/3ddc/.test(g.material?.shader)});}
 return {groups:result.sort((a,b)=>(Number(a.decal)*2+Number(a.emissive))-(Number(b.decal)*2+Number(b.emissive))),buffers,textures,count:cache.size-missing.length,missing,bytes,tableFallback};
 }catch(e){for(const t of textures)t.destroy();for(const b of buffers)b.destroy();throw e;}
}

export function parsePftxs(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=p=>d.getUint32(p,true),text=new TextDecoder();
 check(text.decode(bytes.subarray(0,4))==='PFTX');const count=u(12);check(count<100000);let pos=u(16),directory='';const out=new Map();
 for(let i=0;i<count;i++){
  const n=u(20+i*8),size=u(24+i*8),end=bytes.indexOf(0,n);check(end>=n&&end-n<4096);let path=text.decode(bytes.subarray(n,end));
  if(path.startsWith('@'))path=directory+path.slice(1);else directory=path.slice(0,path.lastIndexOf('/')+1);
  path=path.replace(/\.ftex$/, '');check(pos+size+8<=bytes.length);out.set(path+'.ftex',bytes.subarray(pos,pos+size));
  const p=pos+size;check(text.decode(bytes.subarray(p,p+4))==='PSUB');const subs=u(p+4);check(subs<32);let next=p+8;
  for(let j=0;j<subs;j++){const a=u(p+8+j*8),len=u(p+12+j*8);check(a+len<=bytes.length);out.set(path+'.'+(j+1)+'.ftexs',bytes.subarray(a,a+len));next=Math.max(next,a+len);}
  pos=Math.ceil(next/16)*16;
 }return out;
}
