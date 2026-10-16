import { build } from 'vite';
import { resolve } from 'node:path';
for (const name of ['geometry.js', 'geometry.wasm', 'audio-core.js', 'audio-core.wasm']) {
  if (
    !(await Bun.file(
      resolve(import.meta.dirname, '../../../packages/engine-wasm/dist', name),
    ).exists())
  )
    throw new Error('Missing engine build. Run bun run build:wasm first.');
}
await build({ configFile: resolve(import.meta.dirname, '../vite.config.ts') });
