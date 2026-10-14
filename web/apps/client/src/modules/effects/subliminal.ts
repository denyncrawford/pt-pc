// Timings and envelopes ported from game/ui/subliminal.cpp (original 30 Hz clock).
class Envelope {
  value = 0;
  incoming = 0;
  hold = 0;
  outgoing = 0;
  elapsed = 0;
  start(incoming: number, hold: number, outgoing: number) {
    this.value = 0;
    this.incoming = incoming;
    this.hold = hold;
    this.outgoing = outgoing;
    this.elapsed = 0;
  }
  step(dt: number) {
    this.elapsed += dt;
    if (this.incoming > 0) {
      this.value = Math.min(1, this.elapsed / this.incoming);
      if (this.value === 1) {
        this.incoming = 0;
        this.elapsed = 0;
      }
    } else if (this.hold > 0) {
      if (this.elapsed > this.hold) {
        this.hold = 0;
        this.elapsed = 0;
        return true;
      }
    } else if (this.outgoing > 0) {
      this.value = Math.max(0, 1 - this.elapsed / this.outgoing);
      if (!this.value) {
        this.outgoing = 0;
        this.elapsed = 0;
      }
    }
    return false;
  }
}
export class Subliminal {
  readonly noise = new Envelope();
  readonly burst = new Envelope();
  readonly text = new Envelope();
  image = 0;
  position = [0, 0];
  phase = 0;
  private accumulator = 0;
  private second = false;
  trigger(bit: number, random: () => number = Math.random) {
    const image = new Map([
      [8, 0],
      [16, 1],
      [32, 2],
      [64, 3],
      [128, 0],
      [256, 1],
    ]).get(bit);
    if (image === undefined) throw Error('Unknown original photo fragment');
    this.image = image;
    this.position = [random(), random()];
    this.noise.start(0.03, 0.001, 0.03);
    this.text.start(0.03, 3, 0.03);
    this.second = true;
    this.accumulator = 1 / 30;
  }
  reset() {
    this.noise.start(0, 0, 0);
    this.burst.start(0, 0, 0);
    this.text.start(0, 0, 0);
    this.accumulator = 0;
    this.second = false;
  }
  update(dt: number) {
    if (dt <= 0) return;
    this.accumulator += dt;
    while (this.accumulator >= (1 / 30) * 0.999) {
      this.accumulator = Math.max(0, this.accumulator - 1 / 30);
      if (this.noise.step(1 / 30) && this.second) {
        this.burst.start(0.01, 0, 0.01);
        this.second = false;
      }
      this.burst.step(1 / 30);
      if (this.text.step(1 / 30)) this.noise.start(0.03, 0, 0.03);
      this.phase = (this.phase + 0.7) % 1;
    }
  }
}
export interface SubliminalTexture {
  width: number;
  height: number;
  rgba: Uint8Array;
}
export function createSubliminal(
  device: GPUDevice,
  format: GPUTextureFormat,
  images: SubliminalTexture[],
) {
  const clock = new Subliminal();
  const textures: GPUTexture[] = [];
  let intermediate: GPUTexture | undefined;
  const uniform = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const views = images.map((image) => {
    const t = device.createTexture({
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    textures.push(t);
    device.queue.writeTexture(
      { texture: t },
      new Uint8Array(image.rgba),
      { bytesPerRow: image.width * 4 },
      [image.width, image.height],
    );
    return t.createView();
  });
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });
  const shader = device.createShaderModule({
    code: `
struct State { a:vec4f, b:vec4f }; @group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var image:texture_2d<f32>; @group(0) @binding(2) var noise:texture_2d<f32>;
@group(0) @binding(3) var normal:texture_2d<f32>; @group(0) @binding(4) var samp:sampler;
@group(0) @binding(5) var<uniform> state:State;
struct V { @builtin(position) p:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->V {let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return V(vec4f(p*vec2f(2,-2)+vec2f(-1,1),0,1),p);}
@fragment fn string(v:V)->@location(0) vec4f {
 let uv=vec2f((v.uv.x-.5)*state.b.w+.5,v.uv.y);
 let a=textureSample(image,samp,v.uv+state.a.xy).a*state.a.z;
 return vec4f(mix(textureSample(scene,samp,v.uv).rgb,vec3f(.3491902),clamp(a,0,1)),1);
}
@fragment fn distortion(v:V)->@location(0) vec4f {
 let uv=vec2f((v.uv.x-.5)*state.b.w+.5,v.uv.y);let n=textureSample(normal,samp,vec2f(state.a.w+uv.x,uv.y));
 let shifted=clamp(v.uv+vec2f((-.001+n.w*.002)/state.b.w,-.03+n.y*.06),vec2f(0),vec2f(1));
 let color=textureSample(scene,samp,shifted).rgb;let grain=textureSample(noise,samp,vec2f(state.a.w+uv.x,uv.y)).r;
 let effect=clamp(color+(vec3f(grain)-color)*.1+vec3f(state.b.y*.4,0,0),vec3f(0),vec3f(1));
 return vec4f(mix(textureSample(scene,samp,v.uv).rgb,effect,clamp(state.b.x,0,1)),1);
}`,
  });
  const entries: GPUBindGroupLayoutEntry[] = [0, 1, 2, 3].map((binding) => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: {},
  }));
  entries.push(
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
  );
  const layout = device.createBindGroupLayout({ entries });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeline = (entryPoint: string) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint, targets: [{ format }] },
    });
  const textPipeline = pipeline('string'),
    noisePipeline = pipeline('distortion');
  return {
    reset: () => clock.reset(),
    trigger: (bit: number) => clock.trigger(bit),
    render(
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      destination: GPUTextureView,
      dt: number,
    ) {
      clock.update(dt);
      if (
        !intermediate ||
        intermediate.width !== source.width ||
        intermediate.height !== source.height
      ) {
        intermediate?.destroy();
        intermediate = device.createTexture({
          size: [source.width, source.height],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
      }
      device.queue.writeBuffer(
        uniform,
        0,
        new Float32Array([
          ...clock.position,
          clock.text.value,
          clock.phase,
          clock.noise.value,
          clock.burst.value,
          0,
          source.width / source.height / (16 / 9),
        ]),
      );
      const draw = (p: GPURenderPipeline, src: GPUTextureView, dst: GPUTextureView) => {
        const entries: GPUBindGroupEntry[] = [src, views[clock.image], views[4], views[5]].map(
          (resource, binding) => ({ binding, resource }),
        );
        entries.push(
          { binding: 4, resource: sampler },
          { binding: 5, resource: { buffer: uniform } },
        );
        const group = device.createBindGroup({ layout, entries });
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store' }],
        });
        pass.setPipeline(p);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      };
      draw(textPipeline, source.createView(), intermediate.createView());
      draw(noisePipeline, intermediate.createView(), destination);
    },
    destroy() {
      intermediate?.destroy();
      uniform.destroy();
      for (const texture of textures) texture.destroy();
    },
  };
}
