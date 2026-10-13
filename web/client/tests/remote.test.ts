import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteArchive} from '../remote.js';
test('range transport caches blocks, spans boundaries, checks generation and bounds',async()=>{
 const original=globalThis.fetch,source=new Uint8Array(6*1024*1024);source[4194303]=17;source[4194304]=42;
 let requests=0;
 (globalThis as any).fetch=async(url: any,options: any)=>{
  if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(source.length),ETag:'"v1"'}});
  requests++;assert.equal(options.headers['If-Match'],'"v1"');
  const [,start,end]=options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
  return new Response(source.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${source.length}`}});
 };
 try{
  const file=await remoteArchive('http://127.0.0.1/session/');
  assert.deepEqual([...new Uint8Array(await file.slice(4194303,4194305).arrayBuffer())],[17,42]);
  await file.slice(0,32).arrayBuffer();assert.equal(requests,2);
  await assert.rejects(file.slice(-1,2).arrayBuffer());
  (globalThis as any).fetch=async()=>new Response(null,{status:412});
  const other=await (async()=>{(globalThis as any).fetch=async()=>new Response(null,{headers:{'Content-Length':'10',ETag:'"v1"'}});return remoteArchive('http://127.0.0.1/session/');})();
  (globalThis as any).fetch=async()=>new Response(null,{status:412});await assert.rejects(other.slice(0,4).arrayBuffer(),/412/);
 }finally{(globalThis as any).fetch=original;}
});
