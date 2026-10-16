import { readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { fingerprintRuntime } from './scripts/runtime-fingerprint.ts';
const client = import.meta.dirname;
const source = resolve(client, 'src');
const names = readdirSync(source, { recursive: true })
  .map(String)
  .filter(
    (name) =>
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !name.startsWith('hooks/') &&
      !name.startsWith('types/'),
  );
const entries = Object.fromEntries(
  names.map((name) => [
    basename(name) === 'main.ts' ? 'launcher' : basename(name, '.ts'),
    resolve(source, name),
  ]),
);
const modules = new Map(
  Object.entries(entries).map(([name, path]) => [path.replace(/\.ts$/, ''), name + '.js']),
);
export default defineConfig({
  root: client,
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    {
      name: 'static-document',
      generateBundle() {
        const extractor = resolve(client, '../../packages/pkg-extractor');
        this.emitFile({
          type: 'asset',
          fileName: 'extractor-GPL.txt',
          source: readFileSync(resolve(extractor, 'COPYING-GPL.txt'), 'utf8'),
        });
        const notices = ['@noble/ciphers', '@noble/hashes', 'fflate']
          .map(
            (name) =>
              name +
              '\n' +
              readFileSync(resolve(extractor, 'node_modules', name, 'LICENSE'), 'utf8'),
          )
          .join('\n\n');
        this.emitFile({ type: 'asset', fileName: 'extractor-dependencies.txt', source: notices });

        this.emitFile({
          type: 'asset',
          fileName: 'index.html',
          source: readFileSync(resolve(client, 'index.html'), 'utf8'),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'extractor-LICENSE.txt',
          source: readFileSync(resolve(client, '../../packages/pkg-extractor/LICENSE.txt'), 'utf8'),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'extractor-NOTICE.md',
          source: readFileSync(resolve(client, '../../packages/pkg-extractor/NOTICE.md'), 'utf8'),
        });
      },
    },
    tailwindcss(),
    {
      name: 'runtime-module-urls',
      enforce: 'pre',
      resolveId(id, importer) {
        if (!importer || !id.startsWith('.')) return;
        const name = modules.get(resolve(importer, '..', id));
        if (name || ['geometry.js', 'audio-core.js'].includes(basename(id)))
          return { id: './' + (name ?? basename(id)), external: true };
      },
    },
    react({
      useAtYourOwnRisk_mutateSwcOptions(options) {
        options.jsc ??= {};
        options.jsc.transform ??= {};
        options.jsc.transform.reactCompiler = true;
      },
    }),
    {
      name: 'fingerprint-runtime',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const encoder = new TextEncoder();
          const files = new Map<string, Uint8Array>();
          for (const [name, item] of Object.entries(bundle)) {
            const content = item.type === 'chunk' ? item.code : item.source;
            files.set(name, typeof content === 'string' ? encoder.encode(content) : content);
          }
          for (const name of ['geometry.js', 'geometry.wasm', 'audio-core.js', 'audio-core.wasm']) {
            files.set(name, readFileSync(resolve(client, '../../packages/engine-wasm/dist', name)));
          }
          const result = fingerprintRuntime(files);
          for (const name of result.renamed.keys()) delete bundle[name];
          for (const [fileName, source] of result.files) {
            const existing = bundle[fileName];
            if (existing?.type === 'asset') existing.source = source;
            else this.emitFile({ type: 'asset', fileName, source });
          }
        },
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: entries,
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
      cssFileName: 'app',
    },
    rolldownOptions: { output: { chunkFileNames: 'shared-[hash].js' } },
  },
});
