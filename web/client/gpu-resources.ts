// Counts explicit GPU allocations and destroy calls, not driver-resident VRAM.
// Keep the native GPUDevice identity for GPUCanvasContext.configure.
export function trackGpu(device: any){
 const live=new Map();let created=0,destroyed=0;
 device.resourceSnapshot=()=>({created,destroyed,live:live.size,buffers:[...live.values()].filter((x: any)=>x==='buffer').length,textures:[...live.values()].filter((x: any)=>x==='texture').length});
 for(const key of ['createBuffer','createTexture']){
  const create=device[key].bind(device);
  device[key]=(descriptor: any)=>{
   const resource=create(descriptor),destroy=resource.destroy.bind(resource);let disposed=false;
   live.set(resource,key==='createBuffer'?'buffer':'texture');created++;
   resource.destroy=()=>{if(disposed)return;disposed=true;destroy();live.delete(resource);destroyed++;};return resource;
  };
 }return device;
}
