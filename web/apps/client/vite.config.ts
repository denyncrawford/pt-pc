import { readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
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
