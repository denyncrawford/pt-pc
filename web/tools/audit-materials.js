// Local, read-only audit. Emits metadata/hashes, never extracted game resources.
import {createHash} from 'node:crypto';
import {Qar,loadFtex,materialUniforms} from '../materials.js';
import {loadPlayerMesh} from '../player-body.js';
import {withString} from '../runtime.js';
import create from '../dist/geometry.js';
const stem='/Assets/fox/effect/gr_pic/materials_alp_rgba32_nomip_nrt';
async function sha256(file){const h=createHash('sha256');for await(const chunk of file.stream())h.update(chunk);return h.digest('hex');}
export async function auditMaterials(w,qarFile,sceneFile){
 const q=await new Qar(qarFile,w).open(),table=await loadFtex(q,stem),mesh=await loadPlayerMesh(w,sceneFile),resources=[];
 for(const suffix of ['.ftex','.1.ftexs']){
  const path=stem+suffix,key=withString(w,path,p=>BigInt.asUintN(64,w._texture_pathcode(p))),entry=q.entries.get(key);
  if(!entry)throw Error('Dependencia ausente: '+path);
  resources.push({path,key:key.toString(16).padStart(16,'0'),offset:entry[0],bytes:entry[1],sha256:await sha256(new Blob([await q.read(path)]))});
 }
 const materials=[...new Map(mesh.groups.map(g=>[g.material.name,g])).values()].map(g=>{
  const indices=Object.keys(g.material.vectors).filter(k=>k.startsWith('MatParamIndex_'));
  if(indices.some(k=>k!=='MatParamIndex_0'))throw Error('Material multíndice requiere auditoría: '+g.material.name);
  const params=materialUniforms({...g,player:true},table);
  return {name:g.material.name,shader:g.material.shader,index:g.material.vectors.MatParamIndex_0?.[0]??0,parameters:Array.from(params.slice(16,24))};
 });
 const paths=new Set(mesh.groups.flatMap(g=>Object.values(g.material.textures)));let textureBytes=0;
 for(const path of paths){const t=await loadFtex(q,path,512);textureBytes+=t.rgba.length;}
 return {schema:1,table:{width:table.width,height:table.height,format:table.format,srgb:table.srgb,decodedBytes:table.rgba.length,decodedSha256:await sha256(new Blob([table.rgba])),resources},materials,characterTextures:paths.size,decodedTextureBytes:textureBytes,tableFallback:false,missingTextures:0};
}
if(import.meta.main){
 const [qar,psarc]=Bun.argv.slice(2);if(!qar||!psarc)throw Error('Uso: bun web/tools/audit-materials.js texture.qar chunk1.psarc');
 const q=Bun.file(qar),p=Bun.file(psarc),report=await auditMaterials(await create(),q,p);
 report.containers=await Promise.all([q,p].map(async f=>({name:f.name.split('/').at(-1),bytes:f.size,sha256:await sha256(f)})));
 console.log(JSON.stringify(report,null,2));
}
