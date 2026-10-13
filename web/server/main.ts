// SPDX-License-Identifier: MIT
import {mkdir,readFile,writeFile,rename,rm,chmod,mkdtemp,open} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {files,extractor} from './resources';
import {byteRange} from './range';
const args=process.argv.slice(2);
if(args.includes('--help')) { console.log('PT.BunHost [--data <directorio>] [--no-browser]\nServidor Bun + extractor auxiliar incluido. Vista de geometría; juego completo pendiente.');process.exit(0); }
const dataIndex=args.indexOf('--data');
if(dataIndex>=0&&!args[dataIndex+1])throw new Error('Falta el directorio para --data');
const root=resolve(dataIndex>=0?args[dataIndex+1]:join(homedir(),'Library','Application Support','PT.BunHost'));
await mkdir(root,{recursive:true});
// The exclusive process lock prevents two hosts from changing the same library.
const lockPath=join(root,'.bun-host.lock');
try {const f=await open(lockPath,'wx',0o600);await f.writeFile(String(process.pid));await f.close();}
catch {
 try {
  const existing=(await readFile(join(root,'session-url.txt'),'utf8')).trim();
  if(!/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/.test(existing))throw new Error('URL inválida');
  const response=await fetch(existing+'api/status',{signal:AbortSignal.timeout(1500)});
  if(!response.ok||(await response.json()).backend!=='bun')throw new Error('Servidor inactivo');
  console.log('Ya está abierto: '+existing);
  if(!args.includes('--no-browser'))await Bun.spawn(['open',existing],{stdout:'ignore',stderr:'ignore'}).exited;
  process.exit(0);
 } catch { console.error('La biblioteca está en uso o quedó un bloqueo tras un cierre inesperado: '+lockPath);process.exit(1); }
}
process.on('exit',()=>{try{require('node:fs').unlinkSync(lockPath);}catch{}});
let active:string|null=null;
try{const metadata=JSON.parse(await readFile(join(root,'library.json'),'utf8'));if(/^[a-f0-9-]{36}$/.test(metadata.id))active=metadata.id;}catch{}
let state=active?'ready':'empty',message='',busy=false,child:ReturnType<typeof Bun.spawn>|null=null;
const token=randomBytes(24).toString('hex'),prefix='/'+token+'/',maxPackage=8*1024**3;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const error=(text:string,status:number)=>reply({error:text},status);
const runtime=await mkdtemp(join(root,'.runtime-'));
let extractorPath:string|null=null;
async function prepareExtractor(){
 if(extractorPath)return extractorPath;
 const target=join(runtime,'PT.MacExtract');await Bun.write(target,Bun.file(extractor));await chmod(target,0o700);extractorPath=target;return target;
}
async function importPkg(request:Request){
 if(request.headers.get('content-type')!=='application/octet-stream')return error('Tipo de archivo no válido.',415);
 const length=Number(request.headers.get('content-length'));
 if(!Number.isSafeInteger(length)||length<4096||length>maxPackage)return error('Tamaño de PKG no válido (máximo 8 GiB).',413);
 if(busy)return error('Ya hay una importación en curso.',409);
 busy=true;const id=randomUUID(),upload=join(root,'upload-'+id+'.pkg'),destination=join(root,id),pointer=join(root,'pointer-'+id+'.json');
 let committed=false;
 try{
  state='uploading';message='Recibiendo el PKG…';let received=0;
  const counter=new Transform({transform(chunk,encoding,cb){received+=chunk.length;cb(received>length?new Error('Tamaño recibido incorrecto.'):null,chunk);}});
  if(!request.body)throw new Error('Solicitud vacía.');
  await pipeline(Readable.fromWeb(request.body as any),counter,createWriteStream(upload,{flags:'wx',mode:0o600}));
  if(received!==length)throw new Error('Transferencia incompleta.');
  state='extracting';message='Extrayendo y verificando los archivos…';
  const helper=await prepareExtractor();
  child=Bun.spawn([helper,upload,destination],{env:{...process.env,DOTNET_BUNDLE_EXTRACT_BASE_DIR:join(runtime,'bundle')},stdout:'ignore',stderr:'pipe'});
  // The helper's diagnostics are small; no game data is written to stderr.
  const stderr=new Response(child.stderr as ReadableStream<Uint8Array>).text();
  const code=await child.exited,detail=await stderr;child=null;
  if(code!==0)throw new Error(detail.trim().slice(-2000)||'No se pudo extraer el PKG.');
  await writeFile(pointer,JSON.stringify({id}),{flag:'wx',mode:0o600});await rename(pointer,join(root,'library.json'));committed=true;
  active=id;state='ready';message='Importación completada.';return reply({state});
 }catch(e){state=active?'ready':'empty';message=e instanceof Error?e.message:String(e);return error(message,400);}
 finally{child=null;await rm(upload,{force:true});await rm(pointer,{force:true});if(!committed)await rm(destination,{recursive:true,force:true});busy=false;}
}
const assetNames=new Set(['chunk1.psarc','texture.qar','pathid_list_ps4.bin','manifest.json']);
const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT || 3000),maxRequestBodySize:maxPackage,idleTimeout:255,
 async fetch(request){
  const url=new URL(request.url),origin=server.url.origin;
  if(request.headers.get('host')!==server.url.host||(request.headers.get('origin')&&request.headers.get('origin')!==origin))return error('Origen no permitido.',403);
  if(!url.pathname.startsWith(prefix))return error('No encontrado.',404);
  const path=url.pathname.slice(prefix.length);
  if(path==='api/status'&&request.method==='GET')return reply({state,message,backend:'bun',version:Bun.version,runtime:'wasm-hallway-walk',gamePlayable:false,walkable:true});
  if(path==='api/pkg'&&request.method==='POST'){server.timeout(request,0);return importPkg(request);}
  if(!['GET','HEAD'].includes(request.method))return error('Método no permitido.',405);
  if(path.startsWith('assets/')){
   const name=path.slice(7),id=active;if(!assetNames.has(name)||!id)return error('Archivo no encontrado.',404);
   const file=Bun.file(join(root,id,name));if(!await file.exists())return error('Archivo no encontrado.',404);
   const etag='"'+id+'-'+name+'"';
   if(request.headers.has('if-match')&&request.headers.get('if-match')!==etag&&request.headers.get('if-match')!=='*')return new Response(null,{status:412,headers});
   const h=new Headers({...headers,ETag:etag,'Accept-Ranges':'bytes','Content-Type':name.endsWith('.json')?'application/json':'application/octet-stream'});
   let range:[number,number]|null=null;
   try{range=request.method==='GET'?byteRange(request.headers.get('range'),file.size):null;}
   catch{h.set('Content-Range','bytes */'+file.size);return new Response(null,{status:416,headers:h});}
   if(range){const [start,end]=range;h.set('Content-Range',`bytes ${start}-${end}/${file.size}`);h.set('Content-Length',String(end-start+1));return new Response(file.slice(start,end+1),{status:206,headers:h});}
   h.set('Content-Length',String(file.size));return new Response(request.method==='HEAD'?null:file,{headers:h});
  }
  const resource=files[path||'index.html'];if(!resource)return error('No encontrado.',404);
  return new Response(request.method==='HEAD'?null:Bun.file(resource.path),{headers:{...headers,'Content-Type':resource.mime}});
 },error(e){console.error(e.message);return error('Error del servidor.',500);}
});
const url=server.url.origin+prefix;
await writeFile(join(root,'session-url.txt'),url,{mode:0o600});
console.log('PT_WEB_URL='+url);console.log('Servidor Bun '+Bun.version+' · Biblioteca: '+root+'\nCtrl+C para detener.');
if(!args.includes('--no-browser')){
 const opener=Bun.spawn(['open',url],{stdout:'ignore',stderr:'pipe'});
 if(await opener.exited!==0)console.error('Abre la URL anterior en tu navegador.');
}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;child?.kill();if(child)await child.exited;await server.stop(true);await rm(runtime,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
