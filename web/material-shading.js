// Port of SceneRenderer::CreateBuiltinResources (lighting.glsl samples these LUTs).
export function makeLightingLuts(){
 const fresnel=new Uint8Array(64*64),ndf=new Uint8Array(64*16*16*2);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++)fresnel[y*64+x]=Math.floor(255*(y/63+(1-y/63)*(1-x/63)**5));
 for(let z=0;z<16;z++)for(let y=0;y<16;y++)for(let x=0;x<64;x++){
  const c=Math.sqrt(x/63),r=Math.sqrt(y/15),m=Math.sqrt(z/15),n=2**(12-11*Math.max(r,m)),ny=2**(12-11*r),s=Math.sqrt(c**n*(Math.sqrt(n*ny)+2.04)/8),i=((z*16+y)*64+x)*2;
  ndf[i]=Math.round(255*Math.min(s,1));ndf[i+1]=Math.max(1,Math.round(255/Math.max(s,1)));
 }
 return {fresnel,ndf};
}
export function materialTableRow(texture,index){
 if(!Number.isInteger(index)||index<0||index>255)throw Error('Índice de material fuera de rango');
 if(!texture)return [1,1,1,0,10/255,0,0,0]; // Native built-in resource fallback.
 if(texture.width!==256||texture.height!==2||texture.rgba.length!==2048)throw Error('Tabla de materiales inválida');
 return [...texture.rgba.slice(index*4,index*4+4),...texture.rgba.slice((256+index)*4,(256+index)*4+4)].map(v=>v/255);
}
export const characterWGSL=`
fn characterAlpha(pixel:vec2<f32>)->f32{
 let bayer=array<u32,64>(0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21);
 let p=vec2<u32>(pixel)&vec2(7u);return select(material.flags.x,f32(2u*bayer[p.y*8u+p.x]+1u)/255.0,material.flags.x<0.0);
}
fn srgbDecode(c:vec3<f32>)->vec3<f32>{return select(pow(max((c+0.055)/1.055,vec3(0)),vec3(2.4)),c/12.92,c<=vec3(0.04045));}
fn srgbEncode(c:vec3<f32>)->vec3<f32>{return select(1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-0.055,c*12.92,c<=vec3(0.0031308));}
fn nativeHair(n:vec3<f32>,t:vec3<f32>,b:vec3<f32>,view:vec3<f32>,shift:f32,specular:f32)->f32{
 // Native secondary/mirror views initialize the dominant direction to world +Y.
 let ts=normalize(t+material.surface.w*(2.0*shift-1.0)*b);
 let light=vec3(0.0,-1.0,0.0);
 let lf=normalize(vec3(dot(ts,light),dot(b,light),dot(n,light))+vec3(1e-12));
 let vf=normalize(vec3(dot(ts,view),dot(b,view),dot(n,view))+vec3(1e-12));
 let h=lf+vf;let hl=max(length(h),1e-8);let hb=h.y/hl;
 return specular*pow(clamp(hl*10.0,0.0,1.0),4.0)*pow(max(sqrt(max(1.0-hb*hb,0.0)),1e-8),material.surface.z*exp2(7.0-6.0*selectedParams.w));
}
fn nativeResponse(nh:f32,roughness:f32,lh:f32,nl:f32,transmission:f32)->vec4<f32>{
 let uv=vec3(nh*nh*0.984375+0.0078125,roughness*roughness*0.9375+0.03125,selectedParams.w*selectedParams.w*0.9375+0.03125);
 let ndf=textureSampleLevel(ndfLut,lutSampler,uv,0).rg;
 let d=ndf.x*ndf.x/max(ndf.y*ndf.y,1e-8);
 let f=textureSampleLevel(fresnelLut,lutSampler,vec2(lh,selectedParams.x),0).r;
 let diffuse=clamp(max(nl+transmission*(1.0-nl*nl),transmission*selectedColor.w),0.0,1.0);
 return vec4(selectedColor.rgb*clamp(4.0*nl,0.0,1.0)*f*d,diffuse);
}
`;
