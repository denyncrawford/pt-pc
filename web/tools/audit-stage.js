// Read-only stage dependency inventory, using the native FOX2/FSM decoders.
import create from '../dist/geometry.js';import {loadHallway,withEntry} from '../runtime.js';import {Psarc,parseFpk,fpkEntry} from '../archives.js';
export async function auditStage(w,file,floor){
 if(!/^f\d{3}$/.test(floor))throw Error('Etapa inválida');
 await loadHallway(w,file,()=>{},{scripts:true});
 const entities=JSON.parse(w.UTF8ToString(w._scene_audit_json()));
 const relevant=entities.filter(e=>e.name.includes('|'+floor+'_demo|')||(e.properties.owner||[]).some(n=>n?.includes('|'+floor+'_demo|')));
 const ids=new Set(relevant.filter(e=>e.class==='ShTrapExecRelativeStageDemoPlayCallbackDataElement').flatMap(e=>e.properties.demoId));
 const archive=await new Psarc(file).open(),pkg=parseFpk(await archive.read('as/sh/level/common/resident.fpk')),sequences=[];
 for(const id of ids){const path='/Assets/sh/demo/demo_stream/'+id+'.fsm',frames=withEntry(w,fpkEntry(pkg,path),path,(p,n)=>w._sequence_load(p,n));if(!frames)throw Error('Secuencia inválida: '+path);
 sequences.push({id,path,frames,actors:Array.from({length:w._sequence_actor_count()},(_,i)=>({name:w.UTF8ToString(w._sequence_actor_name(i)),kind:w._sequence_actor_kind(i),units:w._sequence_actor_units(i)})),events:Array.from({length:w._sequence_event_count()},(_,i)=>({frame:w._sequence_event_start(i),type:BigInt.asUintN(64,w._sequence_event_type(i)).toString(16),functor:BigInt.asUintN(64,w._sequence_event_functor(i)).toString(16),sound:w._sequence_event_sound(i)>>>0}))});}
 return {schema:1,floor,entities:relevant,sequences};
}
if(import.meta.main){const [path,floor='f005']=Bun.argv.slice(2);if(!path)throw Error('Uso: bun web/tools/audit-stage.js chunk1.psarc f005');console.log(JSON.stringify(await auditStage(await create(),Bun.file(path),floor),null,2));}
