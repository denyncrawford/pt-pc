import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {GameOptions} from './options.js';
export interface SettingsActions {change(options:GameOptions):void;fullscreen():void;restart():void;capture():void;}
export function mountSettings(container:Element,initial:GameOptions,actions:SettingsActions){
 let sync=(options:GameOptions)=>{};
 function Settings(){const [options,setOptions]=useState(initial);sync=setOptions;
  function update<K extends keyof GameOptions>(key:K,value:GameOptions[K]){const next={...options,[key]:value};setOptions(next);actions.change(next);}
  return <div className="menu-grid"><div><fieldset><legend>Pantalla</legend><label className="setting">Modo de pantalla <button onClick={actions.fullscreen}>Pantalla completa</button></label><label className="setting">Resolución de render <select value={options.renderScale} onChange={e=>update('renderScale',Number(e.currentTarget.value))}><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label></fieldset><fieldset id="menu-graphics"><legend>Gráficos</legend></fieldset></div>
  <div><fieldset><legend>Sonido</legend><label className="setting">Volumen <input aria-label="Volumen" type="range" min="0" max="100" value={options.volume*100} onChange={e=>update('volume',Number(e.currentTarget.value)/100)}/></label></fieldset><fieldset><legend>Controles</legend><label className="setting">Sensibilidad del ratón <input aria-label="Sensibilidad del ratón" type="range" min="0.2" max="3" step="0.1" value={options.sensitivity} onChange={e=>update('sensitivity',Number(e.currentTarget.value))}/></label><p className="control-hint">WASD: movimiento · botón derecho: zoom · Esc: pausa</p></fieldset><fieldset><legend>Partida</legend><button onClick={actions.restart}>Reiniciar partida</button><button onClick={actions.capture}>Ocultar menú para captura</button></fieldset></div></div>;
 }
 const root=createRoot(container);root.render(<Settings/>);return {update:(options:GameOptions)=>sync(options),destroy:()=>root.unmount()};
}
