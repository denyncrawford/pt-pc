import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../dist');
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 4175),
  async fetch(request) {
    const name = new URL(request.url).pathname.slice(1) || 'index.html';
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.'))
      return new Response('Not found', { status: 404 });
    const file = Bun.file(resolve(root, name));
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});
console.log(`Static preview: http://127.0.0.1:${process.env.PORT ?? 4175}`);
