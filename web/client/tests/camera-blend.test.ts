import test from 'node:test';import assert from 'node:assert/strict';
import {cameraCurve,NativeCameraBlend} from '../sequence-player.js';
const near=(a: any,b: any)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('native camera curves respect endpoints, curve rate and instant/linear modes',()=>{
 for(const type of [1,2,3]){near(cameraCurve(type,-1),0);near(cameraCurve(type,2),1);near(cameraCurve(type,.3,0),.3);}
 near(cameraCurve(0,0),1);near(cameraCurve(1,.3,.9),.3);near(cameraCurve(2,.5,.9),.9*Math.SQRT1_2+.05);near(cameraCurve(3,.5,1,.5),.5);
});
test('camera entry follows moving track offset and interpolates lens, not FOV',()=>{
 const from={camera:[0,1,0],yaw:Math.PI-.1,pitch:.2,fov:1};const target={camera:[2,2,0],yaw:-Math.PI+.1,pitch:.2,fov:.6};
 const blend=new NativeCameraBlend({cameraInterpType:1,cameraInterpFrame:60},from);
 assert.deepEqual(blend.apply(target,0).camera,from.camera);const start=blend.apply(target,1);assert.deepEqual(start.camera,from.camera);near(start.yaw,from.yaw);near(start.pitch,from.pitch);
 const half=blend.apply({...target,camera:[4,2,0]},31);assert.deepEqual(half.camera,[3,1.5,0]);near(6.75/Math.tan(half.fov/2),(6.75/Math.tan(.5)+6.75/Math.tan(.3))/2);assert.ok(Math.abs(half.yaw)>3,'shortest path crosses pi');
 assert.deepEqual(blend.apply(target,31),blend.apply(target,31),'paused frame has stable pose');assert.equal(blend.apply(target,61),target);
});
test('roll survives quaternion interpolation and disabled metadata leaves native track unchanged',()=>{
 const view={camera:[0,0,0],yaw:0,pitch:0,fov:1,basis:{right:[0,1,0],up:[-1,0,0]}};
 const blend=new NativeCameraBlend({cameraInterpType:1,cameraInterpFrame:10},view),start=blend.apply({...view,basis:{right:[1,0,0],up:[0,1,0]}},1);
 start.basis.right.forEach((v: any,i: any)=>near(v,view.basis.right[i]));start.basis.up.forEach((v: any,i: any)=>near(v,view.basis.up[i]));
 assert.equal(new NativeCameraBlend({cameraInterpType:0},view).apply(view,1),view);
});
import {CameraHandoff} from '../runtime.js';
test('native handback holds cinematic eye while idle and releases with movement in body space',()=>{
 const h=new CameraHandoff(),feet=[2,0,3],eye=[2.1,1.65,3.2],animated=[2,1.6,3];h.capture(eye,feet,Math.PI/2);h.advance(20,0);h.apply(animated,feet,Math.PI/2).forEach((v: any,i: any)=>near(v,eye[i]));
 h.advance(.5,1);h.apply(animated,feet,Math.PI/2).forEach((v: any,i: any)=>near(v,(eye[i]+animated[i])/2));h.advance(.5,1);assert.equal(h.apply(animated,feet,Math.PI/2),animated);
 h.capture(eye,feet,0);const shifted=h.apply([3,1.6,3],[3,0,3],0);shifted.forEach((v: any,i: any)=>near(v,eye[i]+(i===0?1:0)));h.reset();assert.equal(h.apply(animated,feet,0),animated);
});
