import {Psarc,parseFpk,fpkEntry} from './archives.js';
import {withEntry,withString} from './runtime.js';
// Demo-local fileParams take precedence, matching DemoSystem::FilePath.
export async function loadDemoResources(w,file){
 const archive=await new Psarc(file).open(),entries=new Map();
 for(const name of ['as/sh/level/common/resident.fpk','as/sh/level/common/resident.fpkd']){const pkg=parseFpk(await archive.read(name));for(const e of pkg.entries)entries.set(e.name,()=>fpkEntry(pkg,e.name));}
 const read=path=>{const fn=entries.get(path);if(!fn)throw Error('Falta dependencia de secuencia: '+path);return fn();};
 const path='/Assets/sh/demo/fox_project/promotion/pt_2014/resident_demo.fox2';
 const parse=(path,method)=>withEntry(w,read(path),path,(p,n)=>{const value=w[method](p,n);if(!value)throw Error('Recurso original inválido: '+path);return JSON.parse(w.UTF8ToString(value));});
 const metadata=new Map(parse(path,'_demo_assets_json').map(d=>[d.id,d]));
 const code=name=>withString(w,name,p=>BigInt.asUintN(64,w._demo_name_code(p)).toString());
 const names=new Map([...entries.keys()].map(path=>[code(path),path]));
 const effects=new Map();
 return {entries,read,metadata,code,effect(demo,fileCode){const meta=metadata.get(demo);if(!meta)throw Error('Falta DemoData: '+demo);
  const path=Object.entries(meta.fileParams).find(([key])=>code(key)===fileCode.toString())?.[1]||names.get(fileCode.toString());
  if(!path)throw Error(`${demo}: efecto sin resolver ${fileCode.toString(16)}`);
  if(!effects.has(path))effects.set(path,{path,...parse(path,'_effect_nodes_json')});return effects.get(path);
 }};
}
