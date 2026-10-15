import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '../../../../..');
export const extractor =
  process.env.PT_EXTRACTOR || resolve(root, '.cache/extractor/PT.MacExtract');
export const files: Record<string, { path: string; mime: string }> = {
  'app.css': {
    path: resolve(root, 'web/apps/client/dist/app.css'),
    mime: 'text/css; charset=utf-8',
  },
  'index.html': {
    path: resolve(root, 'web/apps/client/index.html'),
    mime: 'text/html; charset=utf-8',
  },
  ...Object.fromEntries(
    [
      'options.js',
      'renderer-elements.js',
      'native-ui.js',
      'preface.js',
      'preface-overlay.js',
      'lamp.js',
      'effects.js',
      'app.js',
      'archives.js',
      'launcher.js',
      'remote-archive.js',
      'gpu-resources.js',
      'runtime.js',
      'materials.js',
      'lighting.js',
      'first-loop.js',
      'stage-cycle.js',
      'save-game.js',
      'sequence-player.js',
      'demo-resources.js',
      'demo-actors.js',
      'audio.js',
      'audio-worklet.js',
      'player-body.js',
      'postprocess.js',
      'subliminal.js',
      'material-shading.js',
    ].map((name) => [
      name,
      { path: resolve(root, 'web/apps/client/dist', name), mime: 'text/javascript' },
    ]),
  ),
  ...Object.fromEntries(
    ['geometry.js', 'geometry.wasm', 'audio-core.js', 'audio-core.wasm'].map((name) => [
      name,
      {
        path: resolve(root, 'web/packages/engine-wasm/dist', name),
        mime: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      },
    ]),
  ),
};

// New Vite modules can appear after a local rebuild. Only public, flat JS/CSS
// build outputs are eligible; arbitrary paths and library assets never are.
export function resolveResource(name: string) {
  if (files[name]) return files[name];
  if (!/^[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) return undefined;
  const path = resolve(root, 'web/apps/client/dist', name);
  if (!existsSync(path) || !statSync(path).isFile()) return undefined;
  return { path, mime: name.endsWith('.js') ? 'text/javascript' : 'text/css; charset=utf-8' };
}
