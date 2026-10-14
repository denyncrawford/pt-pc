import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const project = resolve(import.meta.dir, '../../../..');
process.chdir(project);
if (!process.argv.includes('--data')) process.argv.push('--data', resolve(project, '.data'));
for (const name of ['geometry.js', 'geometry.wasm', 'audio-core.js', 'audio-core.wasm']) {
  if (!existsSync(resolve(project, 'web/packages/engine-wasm/dist', name)))
    throw new Error(
      'Missing WASM build. Run bun run build:wasm with Emscripten activated, then bun dev.',
    );
}
const build = Bun.spawn(['bun', 'run', '--cwd', resolve(project, 'web/apps/client'), 'build'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
if (await build.exited) throw new Error('Client build failed');
await import('./main');
