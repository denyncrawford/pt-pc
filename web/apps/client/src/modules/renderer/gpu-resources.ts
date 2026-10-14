// Counts explicit GPU allocations and destroy calls, not driver-resident VRAM.
// Keep the native GPUDevice identity for GPUCanvasContext.configure.
interface Destroyable {
  destroy(): void;
}
interface AllocationHost {
  createBuffer(descriptor: GPUBufferDescriptor): Destroyable;
  createTexture(descriptor: GPUTextureDescriptor): Destroyable;
}
export interface ResourceSnapshot {
  created: number;
  destroyed: number;
  live: number;
  buffers: number;
  textures: number;
}
export function trackGpu<D extends AllocationHost>(
  device: D,
): D & { resourceSnapshot(): ResourceSnapshot } {
  const live = new Map<Destroyable, 'buffer' | 'texture'>();
  let created = 0,
    destroyed = 0;
  function track<T extends Destroyable>(resource: T, kind: 'buffer' | 'texture'): T {
    const destroy = resource.destroy.bind(resource);
    let disposed = false;
    live.set(resource, kind);
    created++;
    resource.destroy = () => {
      if (disposed) return;
      disposed = true;
      destroy();
      live.delete(resource);
      destroyed++;
    };
    return resource;
  }
  const buffer = device.createBuffer.bind(device),
    texture = device.createTexture.bind(device);
  device.createBuffer = (descriptor) => track(buffer(descriptor), 'buffer');
  device.createTexture = (descriptor) => track(texture(descriptor), 'texture');
  return Object.assign(device, {
    resourceSnapshot: (): ResourceSnapshot => ({
      created,
      destroyed,
      live: live.size,
      buffers: [...live.values()].filter((x) => x === 'buffer').length,
      textures: [...live.values()].filter((x) => x === 'texture').length,
    }),
  });
}
