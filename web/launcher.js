// SPDX-License-Identifier: MIT
import {remoteArchive} from './remote.js';
// Import the renderer only after choosing Play. The wizard must work on its own.
let game=null,gameOptions={},nativeMenu=null;
function configureGame(values){gameOptions={...gameOptions,...values};game?.configureGame(gameOptions);}
function setMenuPaused(value){game?.setMenuPaused(value);}
async function unloadWalk(){nativeMenu?.destroy();nativeMenu=null;await game?.unloadWalk();}
async function loadGame(){
 if(!game){const module=await import('./app.js');await module.ready;game=module;game.configureGame(gameOptions);}
 return game;
}
const $=id=>document.getElementById(id);
const input=$('pkg'),status=$('loading-status'),error=$('import-error');
let importing=false;
const api=async(path,options)=>{const r=await fetch(new URL(path,import.meta.url),options);const json=await r.json();if(!r.ok)throw new Error(json.error||'No se pudo completar la operación.');return json;};
function step(n,title,description){for(let i=1;i<=3;i++)$('step-'+i).setAttribute('aria-current',i===n?'step':'false');$('wizard-title').textContent=title;$('wizard-description').textContent=description;}
const development=new URL(location.href).searchParams.has('dev');document.body.classList.toggle('development',development);
const progress=$('import-progress');
function loading(title,done,total){step(2,title,'');progress.hidden=false;if(total){progress.max=total;progress.value=done;status.textContent=Math.round(done/total*100)+'%';}else{progress.removeAttribute('value');status.textContent='';}}
function prepared(){step(3,'P.T.','Tu copia está lista.');$('choose-actions').hidden=false;$('resume-library').hidden=false;$('open-viewer').hidden=true;progress.hidden=true;status.textContent='';}
function upload(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',new URL('api/pkg',import.meta.url));xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>{if(e.lengthComputable)loading('Cargando tu copia',e.loaded,e.total);};xhr.upload.onload=()=>loading('Preparando tu copia');xhr.onerror=()=>reject(new Error('Se perdió la conexión. Vuelve a intentarlo.'));xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else reject(new Error('No se pudo preparar esta copia. Selecciona otro archivo o vuelve a intentarlo.'));};xhr.send(file);});}
input.onchange=async()=>{
 const file=input.files[0];if(!file||importing)return;
 importing=true;error.textContent='';$('choose-actions').hidden=true;$('open-viewer').hidden=true;loading('Cargando tu copia');
 try{await upload(file);await $('open-viewer').onclick();}
 catch(e){step(1,'No se pudo cargar','Vuelve a seleccionar tu copia.');error.textContent=e.message;$('choose-actions').hidden=false;}
 finally{importing=false;progress.hidden=true;input.value='';}
};
$('resume-library').onclick=()=> $('open-viewer').onclick();
$('open-viewer').onclick=async()=>{
 error.textContent='';$('open-viewer').disabled=true;$('choose-actions').hidden=true;loading('Cargando partida',0,7);
 try{const runtime=await loadGame();const loaded=await runtime.loadWalk(await remoteArchive(import.meta.url),await remoteArchive(import.meta.url,'texture.qar'),(n,total)=>loading('Cargando partida',n,total),new URL(location.href).searchParams.get('scene')==='hallway'?'hallway':'start');if(!loaded)throw new Error('No se pudo iniciar la partida. Vuelve a intentarlo.');nativeMenu?.destroy();nativeMenu=await runtime.createOriginalMenu($('native-menu'),await remoteArchive(import.meta.url),await remoteArchive(import.meta.url,'texture.qar'),nativeAction);setMenuPaused(true);$('wizard').hidden=true;$('viewer').hidden=false;$('start-game').hidden=false;document.title='P.T. · Web';}
 catch(e){error.textContent=e.message;step(1,'No se pudo iniciar','Vuelve a intentarlo.');$('choose-actions').hidden=false;}
 finally{$('open-viewer').disabled=false;progress.hidden=true;status.textContent='';}
};
$('start-playing').onclick=()=>{$('start-game').hidden=true;setMenuPaused(false);$('enter').click();};
$('back-library').onclick=async()=>{await unloadWalk();$('start-game').hidden=true;$('viewer').hidden=true;$('wizard').hidden=false;prepared();};
try{const s=await api('api/status');if(s.state==='ready')$('resume-library').hidden=false;}catch(e){error.textContent='No se pudo conectar. Recarga la página para intentarlo de nuevo.';}

// Web menu: only implemented controls are interactive; native-only settings are explicit.
const menu=$('game-menu'),confirmation=$('restart-confirm');
const brightnessLevels=[.48,.55,.60,.68,.76,.84,.92,1,1.05,1.09,1.13];
let options={sensitivity:1,invertX:false,brightness:1,invertY:false,subtitles:true,language:"Spa",volume:1,renderScale:1};
try{const saved=JSON.parse(localStorage.getItem('pt-web-options')||'{}');for(const k of Object.keys(options))if(typeof saved[k]===typeof options[k])options[k]=saved[k];}catch{}
options.brightness=Math.max(.48,Math.min(1.13,options.brightness));
options.sensitivity=Math.max(.2,Math.min(3,options.sensitivity));options.volume=Math.max(0,Math.min(1,options.volume));if(![1,.75,.5].includes(options.renderScale))options.renderScale=1;
$('brightness').value=brightnessLevels.reduce((best,v,i)=>Math.abs(v-options.brightness)<Math.abs(brightnessLevels[best]-options.brightness)?i:best,0);$('invert-x').checked=options.invertX;$('sensitivity').value=options.sensitivity;$('master-volume').value=options.volume*100;$('invert-y').checked=options.invertY;$('show-subtitles').checked=options.subtitles;$('render-scale').value=options.renderScale;
configureGame(options);
for(const id of ['subtitle-language','brightness','invert-x','sensitivity','master-volume','invert-y','show-subtitles','render-scale'])$(id).oninput=()=>{options={language:$('subtitle-language').value,brightness:brightnessLevels[Number($('brightness').value)],invertX:$('invert-x').checked,sensitivity:Number($('sensitivity').value),volume:Number($('master-volume').value)/100,invertY:$('invert-y').checked,subtitles:$('show-subtitles').checked,renderScale:Number($('render-scale').value)};configureGame(options);try{localStorage.setItem('pt-web-options',JSON.stringify(options));}catch{}};
let settingsPage=false;
function nativeOptions(){return {...options,brightnessIndex:Number($('brightness').value)};}
function nativeAction(action,value){if(action==='web'){menuPage(true);return;}if(action==='exit'){$('menu-library').click();return;}if(action==='back'){resume();return;}if(action==='brightness'){$('brightness').value=value;options.brightness=brightnessLevels[value];}else if(action==='language'){options.subtitles=!!value;if(value)options.language=value[0].toUpperCase()+value.slice(1);$('show-subtitles').checked=options.subtitles;$('subtitle-language').value=options.language;}else{options[action]=value;$(action==='invertY'?'invert-y':'invert-x').checked=value;}configureGame(options);try{localStorage.setItem('pt-web-options',JSON.stringify(options));}catch{}nativeMenu?.setOptions(nativeOptions());}
function menuPage(web){settingsPage=web;menu.classList.toggle('native-page',!web);$('original-options').hidden=true;$('native-menu').hidden=web;$('native-web-settings').hidden=true;$('web-settings').hidden=!web;$('settings-back').hidden=!web;$('resume-game').hidden=web;$('menu-library').hidden=web;$('menu-title').textContent=web?'CONFIGURACIÓN WEB':'OPCIONES';if(web){nativeMenu?.close();$('menu-title').focus({preventScroll:true});}else nativeMenu?.open(nativeOptions());menu.scrollTop=0;}
$('native-web-settings').onclick=()=>menuPage(true);
$('open-web-settings').onclick=()=>menuPage(true);$('settings-back').onclick=()=>menuPage(false);
function openMenu(){document.body.classList.remove('capture-view');if($('viewer').hidden||menu.open)return;setMenuPaused(true);menu.showModal();menuPage(false);menu.scrollTop=0;}
$('hide-menu-capture').onclick=()=>{nativeMenu?.close();menu.close();document.body.classList.add('capture-view');};
async function resume(){await nativeMenu?.fadeOut();document.body.classList.remove('capture-view');nativeMenu?.close();menu.close();setMenuPaused(false);$('enter').click();}
document.addEventListener('game-pointer-released',openMenu);
document.addEventListener('game-pointer-error',()=>{openMenu();$('menu-error').textContent='Este navegador no pudo capturar el ratón. Abre esta misma dirección en Chrome o Edge y pulsa Continuar. El cursor debe desaparecer y la cámara debe girar sin límites.';});
$('pause-menu').onclick=openMenu;$('resume-game').onclick=resume;menu.addEventListener('cancel',e=>{e.preventDefault();if(settingsPage)menuPage(false);else resume();});
addEventListener('keydown',e=>{if(e.code==='Escape'&&!menu.open&&!confirmation.open&&!$('viewer').hidden){e.preventDefault();e.stopImmediatePropagation();openMenu();}},true);
// Focus loss must not open the menu. Hidden tabs suspend audio in app.js.
addEventListener('focus',()=>{if(!$('viewer').hidden&&!menu.open&&$('start-game').hidden)$('menu-error').textContent='';});
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();}catch(e){$('menu-error').textContent='Pantalla completa no disponible: '+e.message;}};
$('menu-library').onclick=()=>{nativeMenu?.close();menu.close();setMenuPaused(false);$('back-library').click();};
$('restart-session').onclick=()=>confirmation.showModal();$('cancel-restart').onclick=()=>confirmation.close();
$('confirm-restart').onclick=async()=>{confirmation.close();menu.close();setMenuPaused(false);await $('back-library').onclick();await $('open-viewer').onclick();};

for(const id of ['shadows','reflections','indirect','mirrors']){const label=$(id).closest('label');label.classList.add('setting');$('menu-graphics').append(label);}
