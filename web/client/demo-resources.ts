import {Psarc,parseFpk,fpkEntry} from './archives.js';
import {withEntry,withString} from './runtime.js';
// Demo-local fileParams take precedence, matching DemoSystem::FilePath.
export async function loadDemoResources(w: any,file: any){
 const archive=await new Psarc(file).open(),entries=new Map<any, any>();
 for(const name of ['as/sh/level/common/resident.fpk','as/sh/level/common/resident.fpkd']){const pkg=parseFpk(await archive.read(name));for(const e of pkg.entries)entries.set(e.name,()=>fpkEntry(pkg,e.name));}
 const read=(path: any)=>{const fn=entries.get(path);if(!fn)throw Error('Falta dependencia de secuencia: '+path);return fn();};
 const path='/Assets/sh/demo/fox_project/promotion/pt_2014/resident_demo.fox2';
 const parse=(path: any,method: any)=>withEntry(w,read(path),path,(p: any,n: any)=>{const value=w[method](p,n);if(!value)throw Error('Recurso original inválido: '+path);return JSON.parse(w.UTF8ToString(value));});
 const metadata=new Map<any, any>(parse(path,'_demo_assets_json').map((d: any)=>[d.id,d]));
 const code=(name: any)=>withString(w,name,(p: any)=>BigInt.asUintN(64,w._demo_name_code(p)).toString());
 const names=new Map<any, any>([...entries.keys()].map((path: any)=>[code(path),path]));
 const effects=new Map<any, any>();
 return {entries,read,metadata,code,effect(demo: any,fileCode: any){const meta=metadata.get(demo);if(!meta)throw Error('Falta DemoData: '+demo);
  const path=Object.entries<any>(meta.fileParams).find(([key]: any)=>code(key)===fileCode.toString())?.[1]||names.get(fileCode.toString());
  if(!path)throw Error(`${demo}: efecto sin resolver ${fileCode.toString(16)}`);
  if(!effects.has(path))effects.set(path,{path,...parse(path,'_effect_nodes_json')});return effects.get(path);
 }};
}
