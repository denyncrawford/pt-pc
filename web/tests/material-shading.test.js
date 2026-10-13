import test from 'node:test';import assert from 'node:assert/strict';
import {makeLightingLuts,materialTableRow} from '../material-shading.js';
import {materialUniforms,Qar,loadFtex} from '../materials.js';
import {loadPlayerMesh} from '../player-body.js';import create from '../dist/geometry.js';
test('native lighting LUT endpoints, peak and nonzero denominator',()=>{
 const {fresnel,ndf}=makeLightingLuts();assert.equal(fresnel.length,4096);assert.equal(ndf.length,32768);
 assert.equal(fresnel[0],255);assert.equal(fresnel[63],0);assert.equal(fresnel[63*64+63],255);
 assert.equal(ndf[0],0);assert.equal(ndf[1],255);assert.equal(ndf[63*2],255);assert.equal(ndf[63*2+1],11);
 for(let i=1;i<ndf.length;i+=2)assert.ok(ndf[i]>=1);
});
test('material table rows stay linear, bounded, and use the native missing-resource fallback',()=>{
 assert.deepEqual(materialTableRow(null,10),[1,1,1,0,10/255,0,0,0]);
 const rgba=new Uint8Array(2048);rgba.set([1,2,3,4],40);rgba.set([5,6,7,8],1064);
 assert.deepEqual(materialTableRow({width:256,height:2,rgba},10),[1,2,3,4,5,6,7,8].map(v=>v/255));
 assert.throws(()=>materialTableRow(null,256));assert.throws(()=>materialTableRow({width:2,height:256,rgba},10));
});
test('original eye shader resolves iris, lens height and sphere reflection',{skip:!process.env.PT_TEST_QAR||!process.env.PT_TEST_PSARC},async()=>{
 const w=await create(),file=Bun.file(process.env.PT_TEST_PSARC),q=await new Qar(Bun.file(process.env.PT_TEST_QAR),w,file).open(),m=await loadPlayerMesh(w,file),g=m.groups.find(g=>g.material.shader==='fox_3ddf_eye');
 const params=materialUniforms({...g,player:true});assert.equal(params[14],2);assert.ok(Math.abs(params[15]-.6)<1e-6);
 for(const prefix of ['Base_Tex2','LensHeight_Tex','ViewReflection_Tex']){const path=Object.entries(g.material.textures).find(([k])=>k.startsWith(prefix))[1],t=await loadFtex(q,path,512);assert.ok(t.width>1&&t.height>1);assert.equal(t.rgba.length,t.width*t.height*4);}
});

test('QAR resolves signed WASM i64 texture keys as unsigned archive keys',async()=>{
 const bytes=new Uint8Array([12,34,56]),q=new Qar(new Blob([bytes]),{_malloc:()=>0,HEAPU8:new Uint8Array(256),_texture_pathcode:()=>-1n,_free:()=>{}});
 q.entries.set(0xffffffffffffffffn,[0,3]);assert.deepEqual(await q.read('/test.1.ftexs'),bytes);
});
test('original global material table resolves its high-bit stream without fallback',{skip:!process.env.PT_TEST_QAR},async()=>{
 const w=await create(),q=await new Qar(Bun.file(process.env.PT_TEST_QAR),w).open(),t=await loadFtex(q,'/Assets/fox/effect/gr_pic/materials_alp_rgba32_nomip_nrt');
 assert.equal(t.width,256);assert.equal(t.height,2);assert.equal(t.format,0);assert.equal(t.rgba.length,2048);
 assert.notDeepEqual(materialTableRow(t,11),materialTableRow(null,11));
});

test('all character materials select their authored table rows and all maps exist',{skip:!process.env.PT_TEST_QAR||!process.env.PT_TEST_PSARC},async()=>{
 const {auditMaterials}=await import('../tools/audit-materials.js');
 const a=await auditMaterials(await create(),Bun.file(process.env.PT_TEST_QAR),Bun.file(process.env.PT_TEST_PSARC));
 assert.equal(a.tableFallback,false);assert.equal(a.missingTextures,0);assert.equal(a.characterTextures,55);
 assert.deepEqual([...new Set(a.materials.map(m=>m.index))].sort((a,b)=>a-b),[0,4,10,11,29,38,39,41]);
 assert.equal(a.table.srgb,false);assert.equal(a.table.resources[1].key,'b2c3ea97c280d2bf');
 for(const m of a.materials)assert.equal(m.parameters.length,8);
});
test('invalid material indices are diagnosed, never silently rounded or clamped',()=>{
 for(const index of [-1,1.5,256,NaN])assert.throws(()=>materialUniforms({material:{vectors:{MatParamIndex_0:[index]}}}),/Índice/);
});

test('environment materials select native table rows and lamp emission vectors',()=>{
 const wall=materialUniforms({material:{shader:'fox_3ddf_basic_nrmuv',vectors:{MatParamIndex_0:[24]}}});assert.equal(wall[14],1);
 const lamp=materialUniforms({material:{shader:'fox_3dfw_constant',vectors:{SelfColor:[.2,.3,.4,1],SelfColorIntensity:[8]}}});assert.equal(lamp[14],-1);assert.equal(lamp[8],8);assert.ok(Math.abs(lamp[4]-.2)<1e-6);
});
test('multi-material selects authored rows, ignores unused sentinel indices and preserves detail parameters',()=>{
 const m={shader:'fox_3ddf_subnorm_multimt_nrmuv',technique:'fox3DDF_Blin_SubNorm_2MT_LNM',textures:{SubNormalMap_Tex_LIN:'detail'},vectors:{MatParamIndex_0:[23],MatParamIndex_1:[28],MatParamIndex_2:[-1],SubNormal_Blend:[.6],URepeat_UV:[4],VRepeat_UV:[3],MinRoughness:[.2],RoughnessFrequency:[2]}};
 const rgba=new Uint8Array(256*2*4);rgba[28*4]=123;const u=materialUniforms({material:m},{width:256,height:2,rgba});
 assert.equal(u[56],2);assert.equal(u[32],Math.fround(123/255));assert.deepEqual([...u.slice(25,28)],[4,3,1]);assert.equal(u[30],1);
 assert.throws(()=>materialUniforms({material:{...m,vectors:{...m.vectors,MatParamIndex_1:[-1]}}}),/Índice/);
});
