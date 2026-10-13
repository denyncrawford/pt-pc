import { deflateSync } from 'node:zlib';
export function triangleFmdl() {
  const b=new Uint8Array(334),d=new DataView(b.buffer),u16=(p,v)=>d.setUint16(p,v,true),u32=(p,v)=>d.setUint32(p,v,true);
  b.set(new TextEncoder().encode('FMDL'));u32(8,64);u32(32,5);u32(36,1);u32(40,128);u32(48,256);
  [[3,1,0],[9,1,48],[10,1,56],[11,2,64],[14,2,72]].forEach(([kind,count,offset],i)=>{const p=64+i*8;b[p]=kind;u16(p+2,count);u32(p+4,offset);});
  u32(104,2);u32(108,0);u32(112,78); // vertex-data buffer
  u16(138,3);u32(148,3); // mesh vertex/index counts
  b[176]=1;b[177]=2; // layout: one stream, two elements
  b[185]=2;b[186]=24; // stream: interleaved position/normal
  b[192]=0;b[193]=1;b[196]=2;b[197]=1;u16(198,12);
  u16(200,0);u32(204,72);u32(208,0);u16(216,1);u32(220,6);u32(224,72);
  const values=[-1,0,0,0,0,1, 1,0,0,0,0,1, 0,1,0,0,0,1];
  values.forEach((v,i)=>d.setFloat32(256+i*4,v,true));u16(328,0);u16(330,1);u16(332,2);return b;
}
export function fpk(name='test.fmdl',body=triangleFmdl()) {
  const encoded=new TextEncoder().encode(name),offset=96+encoded.length,b=new Uint8Array(offset+body.length),d=new DataView(b.buffer);
  const u32=(p,v)=>d.setUint32(p,v,true);b.set(new TextEncoder().encode('foxfpk'));u32(36,1);
  u32(48,offset);u32(56,body.length);u32(64,96);u32(72,encoded.length);b.set(encoded,96);b.set(body,offset);return b;
}
export function psarc(name='as/sh/level/promotion/pt_2014/hallway/pt14_hallway.fpk',body=fpk()) {
  const raw=[new TextEncoder().encode(name+'\n'),body],chunks=raw.map(b=>deflateSync(b));
  const tocLength=32+2*30+2*2,b=new Uint8Array(tocLength+chunks.reduce((s,c)=>s+c.length,0)),d=new DataView(b.buffer);
  b.set(new TextEncoder().encode('PSAR'));b.set(new TextEncoder().encode('zlib'),8);
  d.setUint32(12,tocLength);d.setUint32(16,30);d.setUint32(20,2);d.setUint32(24,65536);
  let offset=tocLength;
  raw.forEach((r,i)=>{const p=32+i*30;d.setUint32(p+16,i);
    function be40(at,v){for(let j=4;j>=0;j--){b[at+j]=v%256;v=Math.floor(v/256);}}
    be40(p+20,r.length);be40(p+25,offset);d.setUint16(92+i*2,chunks[i].length);b.set(chunks[i],offset);offset+=chunks[i].length;});return b;
}
// Minimal independently constructed GEOM node 0 with a polygon and float vertices.
export function quadGeom(points) {
 const b=new Uint8Array(320),d=new DataView(b.buffer),u32=(p,v)=>d.setUint32(p,v,true);
 u32(0,201209110);u32(4,32);u32(32+0x18,48); // node -> group at 80
 u32(80+0x0c,32);u32(80+0x10,64); // group -> payload at 112
 u32(112+0x10,80);b[144]=1; // one block -> shape at 192, terminator
 u32(192,(1<<24)|(0x200<<4)|2);u32(192+0x1c,4); // quad, double sided, header at 256
 [0,1,2,3].forEach((v,i)=>d.setUint16(224+i*2,v,true));
 d.setBigInt64(256+0x10,32n,true);
 // Expand to fit the vertex table at 288.
 const result=new Uint8Array(352);result.set(b);const f=new DataView(result.buffer);
 points.forEach((v,i)=>v.forEach((c,k)=>f.setFloat32(288+i*16+k*4,c,true)));
 return result;
}
