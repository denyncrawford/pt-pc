import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const project=resolve(import.meta.dir,'../..');
process.chdir(project);
if(!process.argv.includes('--data'))process.argv.push('--data',resolve(project,'.data'));
for(const name of ['geometry.js','geometry.wasm','audio-core.js','audio-core.wasm']){
 if(!existsSync(resolve(project,'web/client/dist',name)))throw new Error('Missing WASM build. Run bun run build:wasm with Emscripten activated, then bun dev.');
}
await import('../web-build');
await import('./main');
