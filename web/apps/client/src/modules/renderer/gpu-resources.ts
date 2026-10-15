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

/** Bounded CPU/RAF evidence. This does not measure GPU execution time. */
export class FrameMetrics {
  private samples: { intervalMs: number; cpuMs: number; stage: string }[] = [];
  private cursor = 0;
  private previous: number | null = null;
  private pending: { intervalMs: number; stage: string } | null = null;
  constructor(private readonly capacity = 3600) {
    if (!Number.isInteger(capacity) || capacity < 1) throw Error('Invalid frame capacity');
  }
  begin(time: number, active: boolean, stage: string): void {
    this.pending =
      active && this.previous !== null ? { intervalMs: time - this.previous, stage } : null;
    this.previous = active ? time : null;
  }
  end(cpuMs: number): void {
    if (!this.pending) return;
    this.samples[this.cursor] = { ...this.pending, cpuMs };
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pending = null;
  }
  reset(): void {
    this.samples = [];
    this.cursor = 0;
    this.previous = null;
    this.pending = null;
  }
  snapshot() {
    return [...new Set(this.samples.map((sample) => sample.stage))].map((stage) => {
      const samples = this.samples.filter((sample) => sample.stage === stage);
      const intervals = samples.map((sample) => sample.intervalMs).sort((a, b) => a - b);
      const percentile = (p: number) => intervals[Math.ceil(intervals.length * p) - 1];
      return {
        stage,
        frames: samples.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        worstMs: intervals[intervals.length - 1],
        cpuWorstMs: Math.max(...samples.map((sample) => sample.cpuMs)),
        over33Ms: intervals.filter((ms) => ms > 33).length,
        over50Ms: intervals.filter((ms) => ms > 50).length,
        over100Ms: intervals.filter((ms) => ms > 100).length,
      };
    });
  }
}
