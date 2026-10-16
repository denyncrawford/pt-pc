import { build } from 'vite';
import { resolve } from 'node:path';
// The engine uses emitted module URLs; watch builds preserve that same layout.
await build({
  configFile: resolve(import.meta.dirname, '../vite.config.ts'),
  build: { watch: {} },
});
process.env.PORT ??= '3000';
await import('./serve-static');
