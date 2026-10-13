import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {errorMessage} from './options.js';
export interface WizardActions {
 start(onProgress:(done:number,total:number)=>void):Promise<void>;
 upload(file:File,onProgress:(done?:number,total?:number)=>void):Promise<void>;
 hasLibrary():Promise<boolean>;
}
type WizardState = {kind:'choose';ready:boolean;error?:string} | {kind:'loading';title:string;done?:number;total?:number} | {kind:'playing'};
export function mountWizard(container:Element,actions:WizardActions) {
 let showLibrary=()=>{};
 let startGame:()=>Promise<void>=async()=>{};
 function Wizard(){
  const [state,setState]=useState<WizardState>({kind:'choose',ready:false});
  const busy=useRef(false);
  showLibrary=()=>setState({kind:'choose',ready:true});
  useEffect(()=>{let active=true;actions.hasLibrary().then(ready=>{if(active&&!busy.current)setState({kind:'choose',ready});}).catch(()=>{if(active)setState({kind:'choose',ready:false,error:'No se pudo conectar. Recarga la página para intentarlo de nuevo.'});});return()=>{active=false;};},[]);
  async function start(file?:File){
   if(busy.current)return;busy.current=true;
   try {
    if(file){setState({kind:'loading',title:'Cargando tu copia'});await actions.upload(file,(done,total)=>setState({kind:'loading',title:total?'Cargando tu copia':'Preparando tu copia',done,total}));}
    setState({kind:'loading',title:'Cargando partida',done:0,total:7});
    await actions.start((done,total)=>setState({kind:'loading',title:'Cargando partida',done,total}));
    setState({kind:'playing'});
   }catch(error){setState({kind:'choose',ready:true,error:errorMessage(error)});}
   finally{busy.current=false;}
  }
  startGame=()=>start();
  if(state.kind==='playing')return null;
  const loading=state.kind==='loading';
  return <section id="wizard"><div className="eyebrow">P.T. / WEB</div><p className="credit">by denyncrawford and LoreanXavier</p>
   <h1>{loading?state.title:state.error?'No se pudo iniciar':'P.T.'}</h1>
   {!loading&&<><p>Selecciona tu copia para comenzar.</p><div className="actions"><label className="file">Seleccionar PKG<input type="file" accept=".pkg" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void start(file);}}/></label>{state.ready&&<button onClick={()=>void start()}>Jugar</button>}</div>{state.error&&<p id="import-error" role="alert">{state.error}</p>}</>}
   {loading&&<><progress aria-label="Preparando archivos" max={state.total??1} value={state.total?state.done:undefined}/><p role="status">{state.total?`${Math.round((state.done??0)/state.total*100)}%`:''}</p></>}
  </section>;
 }
 const root=createRoot(container);root.render(<Wizard/>);
 return {start:()=>startGame(),showLibrary:()=>showLibrary(),destroy:()=>root.unmount()};
}
