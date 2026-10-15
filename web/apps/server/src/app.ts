// SPDX-License-Identifier: MIT
import { Hono } from 'hono';
import { resolveResource } from './lib/resources';
import { headers, reply, error } from './http/responses';
import type { createLibrary } from './services/library';
import { serveAsset } from './routes/assets';

type Library = Awaited<ReturnType<typeof createLibrary>>;
interface AppOptions {
  root: string;
  prefix: string;
  library: Pick<Library, 'active' | 'status' | 'importPkg'>;
  serverUrl: () => URL;
  disableUploadTimeout: (request: Request) => void;
}

export function createApp(options: AppOptions) {
  const { root, prefix, library } = options;
  const app = new Hono();
  app.use('*', async (c, next) => {
    const request = c.req.raw;
    const url = options.serverUrl();
    const origin = request.headers.get('origin');
    if (request.headers.get('host') !== url.host || (origin && origin !== url.origin)) {
      return error('Origen no permitido.', 403);
    }
    if (!new URL(request.url).pathname.startsWith(prefix)) return error('No encontrado.', 404);
    await next();
  });
  app.get(prefix + 'api/status', () =>
    reply({
      ...library.status,
      backend: 'bun',
      version: Bun.version,
      runtime: 'wasm-hallway-walk',
      gamePlayable: false,
      walkable: true,
    }),
  );
  app.post(prefix + 'api/pkg', (c) => {
    // Keep the raw streaming body; never parse a multi-GiB upload into memory.
    options.disableUploadTimeout(c.req.raw);
    return library.importPkg(c.req.raw);
  });
  app.on(['GET', 'HEAD'], prefix + 'assets/*', (c) =>
    serveAsset(c.req.raw, new URL(c.req.url).pathname.slice(prefix.length), root, library.active),
  );
  app.on(['GET', 'HEAD'], prefix + '*', (c) => {
    const path = new URL(c.req.url).pathname.slice(prefix.length);
    const resource = resolveResource(path || 'index.html');
    if (!resource) return error('No encontrado.', 404);
    return new Response(c.req.method === 'HEAD' ? null : Bun.file(resource.path), {
      headers: { ...headers, 'Content-Type': resource.mime },
    });
  });
  app.notFound((c) =>
    error(
      ['GET', 'HEAD'].includes(c.req.method) ? 'No encontrado.' : 'Método no permitido.',
      ['GET', 'HEAD'].includes(c.req.method) ? 404 : 405,
    ),
  );
  app.onError((e) => {
    console.error(e.message);
    return error('Error del servidor.', 500);
  });
  return app;
}
