// A stage is published only after preparation succeeds. A failed candidate never
// disposes the current stage; a retry creates a new candidate.
export class StageCycle {
declare current: any;
declare phase: any;
declare pending: any;
declare error: any;
declare generation: any;
declare history: any;

 constructor(current: any){this.current=current;this.phase='active';this.pending=null;this.error=null;this.generation=0;this.history=[];}
 async prepare(destination: any,loader: any){
  if(this.phase==='blocked')throw this.error;
  if(this.phase==='disposed')throw Error('Ciclo de etapas descargado');
  if(this.pending)throw Error('Ya hay una etapa en preparación');
  const token=++this.generation;this.phase='preparing';this.error=null;
  const pending={destination,token,resource:null};this.pending=pending;
  try{
   const resource=await loader(destination);
   pending.resource=resource;
   if(this.generation!==token){resource?.destroy?.();return false;}
   if(!resource||resource.floor!==destination)throw Error('La etapa preparada no coincide con el destino');
   this.phase='ready';return true;
  }catch(error){if(this.generation===token){pending.resource?.destroy?.();this.pending=null;this.phase='active';this.error=error;}throw error;}
 }
 transfer(validate: any){
  if(this.phase!=='ready'||!this.pending)throw Error('El destino no está preparado');
  const next=this.pending.resource,previous=this.current;
  // Validation must not mutate either stage. It may check floor, connector and events.
  validate(previous,next);
  this.current=next;this.pending=null;this.phase='active';this.error=null;
  this.history.push({from:previous.floor,to:next.floor});if(this.history.length>32)this.history.shift();
  previous.destroy?.();return next;
 }
 fail(context: any){this.error=new Error(`${this.current.floor}: ${context}`);this.phase='blocked';throw this.error;}
 destroy(){if(this.phase==='disposed')return;++this.generation;this.pending?.resource?.destroy?.();this.pending=null;this.current.destroy?.();this.phase='disposed';}
}
