import test from 'node:test';
import assert from 'node:assert/strict';
import { createLighting } from '../src/modules/renderer/lighting';

test('single-room lighting survives transitions; paired stages retire only their duplicate lights and probes', async () => {
  const previous = {
    GPUTextureUsage: globalThis.GPUTextureUsage,
    GPUBufferUsage: globalThis.GPUBufferUsage,
    GPUShaderStage: globalThis.GPUShaderStage,
  };
  Object.assign(globalThis, {
    GPUTextureUsage: {
      RENDER_ATTACHMENT: 1,
      TEXTURE_BINDING: 2,
      COPY_DST: 4,
      COPY_SRC: 8,
      STORAGE_BINDING: 16,
    },
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 },
    GPUShaderStage: { FRAGMENT: 1, VERTEX: 2 },
  });
  const live = new Set(),
    writes = new Map();
  const allocation = () => {
    const r = { createView: () => ({}), destroy: () => live.delete(r) };
    live.add(r);
    return r;
  };
  let shadowPasses = 0;
  const pass = () => ({
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed() {},
    dispatchWorkgroups() {},
    end() {},
  });
  const device = {
    limits: { maxTextureArrayLayers: 256 },
    pushErrorScope() {},
    popErrorScope: async () => null,
    createTexture: allocation,
    createBuffer: allocation,
    queue: {
      writeBuffer: (b: any, o: any, data: any) => writes.set(b, Array.from(data)),
      submit() {},
      onSubmittedWorkDone: async () => {},
    },
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createBindGroup: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipelineAsync: async () => ({}),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createCommandEncoder: () => ({
      beginRenderPass: (descriptor: { colorAttachments: unknown[] }) => {
        if (!descriptor.colorAttachments.length) shadowPasses++;
        return pass();
      },
      beginComputePass: pass,
      finish: () => ({}),
    }),
  };
  try {
    const lighting = await createLighting(device),
      mesh = { surface: { groups: [] } },
      pipeline = { getBindGroupLayout: () => ({}) };
    // The renderer reserves a placeholder depth layer even without shadow lights.
    const unshadowed = await lighting.prepare(
      mesh,
      {},
      pipeline,
      [{ data: new Float32Array(28) }],
      [],
      null,
    );
    unshadowed.refreshShadows(device.createCommandEncoder());
    unshadowed.destroy();
    assert.equal(live.size, 0);
    for (const paired of [false, true]) {
      writes.clear();
      const lights = Array.from({ length: 6 }, () => {
          const data = new Float32Array(28);
          data[3] = 8;
          data[4] = 1;
          data[15] = 1;
          data[16] = 1;
          return { data, dynamic: true };
        }),
        probes = Array.from({ length: 2 }, () => ({ data: new Float32Array(60), dynamic: true }));
      const scene = await lighting.prepare(
        mesh,
        {},
        pipeline,
        lights,
        probes,
        null,
        paired ? { lights: 3, probes: 1 } : undefined,
      );
      const buffer = [...writes].find(([, a]: any) => a.length === 8 + 128 * 28)[0];
      scene.setTransition(false);
      assert.equal(writes.get(buffer)[0], paired ? 3 : 6);
      assert.equal(writes.get(buffer)[7], paired ? 1 : 2);
      scene.setTransition(true);
      assert.equal(writes.get(buffer)[0], 6);
      assert.equal(writes.get(buffer)[7], 2);
      const probeBuffer = [...writes].find(([, data]: any) => data.length === 120)[0];
      probes[0].data[24] = 0.75;
      scene.updateDynamic();
      assert.equal(writes.get(probeBuffer)[24], 0.75, 'changed native SH reaches GPU buffer');
      probes[0].data.fill(0);
      scene.updateDynamic();
      assert.equal(writes.get(probeBuffer)[24], 0, 'disabled probe leaves no residual light');
      // A disabled lamp contributes no shadow passes; re-enabling it restores
      // all six faces before rendering, including when geometry changes.
      for (const enabled of [false, true]) {
        lights[0].data[16] = Number(enabled);
        assert.equal(scene.updateDynamic(), true);
        assert.equal(writes.get(buffer)[12], enabled ? 1 : 0);
        shadowPasses = 0;
        scene.refreshShadows(device.createCommandEncoder());
        assert.equal(shadowPasses, enabled ? 36 : 30);
      }
      scene.finishTransition();
      assert.equal(writes.get(buffer)[0], paired ? 3 : 6);
      assert.equal(writes.get(buffer)[7], paired ? 1 : 2);
      scene.destroy();
      assert.equal(live.size, 0);
    }
  } finally {
    Object.assign(globalThis, previous);
  }
});
