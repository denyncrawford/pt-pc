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
