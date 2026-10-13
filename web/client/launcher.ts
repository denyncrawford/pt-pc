// SPDX-License-Identifier: MIT
import {flushSync} from 'react-dom';
import {remoteArchive} from './remote.js';
import {mountWizard} from './wizard.js';
import {mountSettings} from './web-settings.js';
import {brightnessIndex,brightnessLevels,errorMessage,parseOptions,type GameOptions} from './options.js';
// Only the renderer-owned canvas and native dialogs cross this imperative boundary.
function node<T extends HTMLElement>(id:string,kind:{new():T}):T{const element=document.getElementById(id);if(!(element instanceof kind))throw new Error(`Missing UI element: ${id}`);return element;}
const viewer=node('viewer',HTMLElement),startGame=node('start-game',HTMLElement),menu=node('game-menu',HTMLDialogElement),confirmation=node('restart-confirm',HTMLDialogElement),menuError=node('menu-error',HTMLElement);
let game:typeof import('./app.js')|null=null;
let nativeMenu:Awaited<ReturnType<typeof import('./app.js')['createOriginalMenu']>>|null=null;
let options:GameOptions=parseOptions(null);
try{options=parseOptions(JSON.parse(localStorage.getItem('pt-web-options')??'null'));}catch{}
function configure(values:GameOptions){options=values;game?.configureGame(options);try{localStorage.setItem('pt-web-options',JSON.stringify(options));}catch{}settings.update(options);}
async function loadGame(){if(!game){const module=await import('./app.js');await module.ready;game=module;game.configureGame(options);}return game;}
function pause(value:boolean){game?.setMenuPaused(value);}
const development=new URL(location.href).searchParams.has('dev');document.body.classList.toggle('development',development);
async function start(progress:(done:number,total:number)=>void){
 const runtime=await loadGame();
 const archive=await remoteArchive(import.meta.url),textures=await remoteArchive(import.meta.url,'texture.qar');
 const loaded=await runtime.loadWalk(archive,textures,progress,new URL(location.href).searchParams.get('scene')==='hallway'?'hallway':'start');
 if(!loaded)throw new Error('No se pudo iniciar la partida. Vuelve a intentarlo.');
 nativeMenu?.destroy();nativeMenu=await runtime.createOriginalMenu(node('native-menu',HTMLCanvasElement),archive,textures,nativeAction);
 pause(true);viewer.hidden=false;startGame.hidden=false;document.title='P.T. · Web';
}
function upload(file:File,progress:(done?:number,total?:number)=>void):Promise<void>{return new Promise((resolve,reject)=>{
 const xhr=new XMLHttpRequest();xhr.open('POST',new URL('api/pkg',import.meta.url));xhr.setRequestHeader('Content-Type','application/octet-stream');
 xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(e.loaded,e.total);};xhr.upload.onload=()=>progress();
 xhr.onerror=()=>reject(new Error('Se perdió la conexión. Vuelve a intentarlo.'));
 xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('No se pudo preparar esta copia. Selecciona otro archivo o vuelve a intentarlo.'));xhr.send(file);
});}
let wizard:ReturnType<typeof mountWizard>;
let settings:ReturnType<typeof mountSettings>;
flushSync(()=>{
 wizard=mountWizard(node('wizard-root',HTMLElement),{start,upload,async hasLibrary(){const response=await fetch(new URL('api/status',import.meta.url));if(!response.ok)throw new Error('Status unavailable');const value:unknown=await response.json();return typeof value==='object'&&value!==null&&'state' in value&&value.state==='ready';}});
 settings=mountSettings(node('web-settings',HTMLElement),options,{change:configure,fullscreen:()=>void fullscreen(),restart:()=>confirmation.showModal(),capture(){nativeMenu?.close();menu.close();document.body.classList.add('capture-view');}});
});
async function library(){nativeMenu?.destroy();nativeMenu=null;await game?.unloadWalk();startGame.hidden=true;viewer.hidden=true;wizard.showLibrary();}
node('start-playing',HTMLButtonElement).onclick=()=>{startGame.hidden=true;pause(false);node('enter',HTMLButtonElement).click();};
node('back-library',HTMLButtonElement).onclick=()=>void library();
let settingsPage=false;
function nativeOptions(){return {...options,brightnessIndex:brightnessIndex(options.brightness)};}
function nativeAction(action:string,value:unknown){
 if(action==='web'){menuPage(true);return;}if(action==='exit'){void exitToLibrary();return;}if(action==='back'){void resume();return;}
 const next={...options};
 if(action==='brightness'&&typeof value==='number'&&Number.isInteger(value)&&brightnessLevels[value]!==undefined)next.brightness=brightnessLevels[value]!;
 else if(action==='language'&&(typeof value==='string'||value===null||value===false)){next.subtitles=!!value;if(typeof value==='string'&&value)next.language=value[0]!.toUpperCase()+value.slice(1);}
 else if((action==='invertX'||action==='invertY')&&typeof value==='boolean')next[action]=value;
 configure(next);nativeMenu?.setOptions(nativeOptions());
}
function menuPage(web:boolean){settingsPage=web;menu.classList.toggle('native-page',!web);node('original-options',HTMLElement).hidden=true;node('native-menu',HTMLCanvasElement).hidden=web;node('native-web-settings',HTMLButtonElement).hidden=true;node('web-settings',HTMLElement).hidden=!web;node('settings-back',HTMLButtonElement).hidden=!web;node('resume-game',HTMLButtonElement).hidden=web;node('menu-library',HTMLButtonElement).hidden=web;const title=node('menu-title',HTMLElement);title.textContent=web?'CONFIGURACIÓN WEB':'OPCIONES';if(web){nativeMenu?.close();title.focus({preventScroll:true});}else nativeMenu?.open(nativeOptions());menu.scrollTop=0;}
node('native-web-settings',HTMLButtonElement).onclick=()=>menuPage(true);node('open-web-settings',HTMLButtonElement).onclick=()=>menuPage(true);node('settings-back',HTMLButtonElement).onclick=()=>menuPage(false);
function openMenu(){document.body.classList.remove('capture-view');if(viewer.hidden||menu.open)return;pause(true);menu.showModal();menuPage(false);menu.scrollTop=0;}
async function resume(){await nativeMenu?.fadeOut();document.body.classList.remove('capture-view');nativeMenu?.close();menu.close();pause(false);node('enter',HTMLButtonElement).click();}
document.addEventListener('game-pointer-released',openMenu);
document.addEventListener('game-pointer-error',()=>{openMenu();menuError.textContent='Este navegador no pudo capturar el ratón. Abre esta misma dirección en Chrome o Edge y pulsa Continuar.';});
node('pause-menu',HTMLButtonElement).onclick=openMenu;node('resume-game',HTMLButtonElement).onclick=()=>void resume();menu.addEventListener('cancel',e=>{e.preventDefault();if(settingsPage)menuPage(false);else void resume();});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!menu.open&&!confirmation.open&&!viewer.hidden){e.preventDefault();e.stopImmediatePropagation();openMenu();}},true);
addEventListener('focus',()=>{if(!viewer.hidden&&!menu.open&&startGame.hidden)menuError.textContent='';});
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await viewer.requestFullscreen();}catch(error){menuError.textContent='Pantalla completa no disponible: '+errorMessage(error);}}
async function exitToLibrary(){nativeMenu?.close();menu.close();pause(false);await library();}
node('menu-library',HTMLButtonElement).onclick=()=>void exitToLibrary();
node('cancel-restart',HTMLButtonElement).onclick=()=>confirmation.close();
node('confirm-restart',HTMLButtonElement).onclick=async()=>{confirmation.close();await exitToLibrary();await wizard.start();};
// Renderer feature controls remain renderer-owned; React never reconciles these nodes.
for(const id of ['shadows','reflections','indirect','mirrors']){const label=node(id,HTMLInputElement).closest('label');if(label){label.classList.add('setting');node('menu-graphics',HTMLElement).append(label);}}
