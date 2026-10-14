import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';

test('Hono preserves origin checks, token routes, raw uploads, ranges and HEAD', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pt-hono-test-'));
  const prefix = '/test-session/';
  let uploaded = 0;
  let timeoutDisabled = false;
  const app = createApp({
    root,
    prefix,
    serverUrl: () => new URL('http://127.0.0.1:3000'),
    disableUploadTimeout: () => {
      timeoutDisabled = true;
    },
    library: {
      active: 'fixture',
      status: { state: 'ready', message: '' },
      importPkg: async (request) => {
        uploaded = (await request.arrayBuffer()).byteLength;
        return Response.json({ state: 'ready' });
      },
    },
  });
  const request = (path: string, init: RequestInit = {}) =>
    app.request('http://127.0.0.1:3000' + path, {
      ...init,
      headers: { host: '127.0.0.1:3000', ...init.headers },
    });
  try {
    await mkdir(join(root, 'fixture'));
    await writeFile(join(root, 'fixture', 'chunk1.psarc'), new Uint8Array([1, 2, 3, 4]));
    expect((await request('/api/status')).status).toBe(404);
    expect(
      (await request(prefix + 'api/status', { headers: { origin: 'https://foreign.test' } }))
        .status,
    ).toBe(403);
    expect(
      (await request(prefix + 'api/status', { headers: { host: 'foreign.test' } })).status,
    ).toBe(403);
    const status = await request(prefix + 'api/status');
    expect(status.status).toBe(200);
    expect(status.headers.get('Cache-Control')).toBe('no-store');
    expect(
      (await request(prefix + 'api/pkg', { method: 'POST', body: new Uint8Array(4096) })).status,
    ).toBe(200);
    expect(uploaded).toBe(4096);
    expect(timeoutDisabled).toBe(true);
    const asset = prefix + 'assets/chunk1.psarc';
    const range = await request(asset, { headers: { range: 'bytes=1-2' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('Content-Range')).toBe('bytes 1-2/4');
    expect([...new Uint8Array(await range.arrayBuffer())]).toEqual([2, 3]);
    const head = await request(asset, { method: 'HEAD' });
    expect(head.headers.get('Content-Length')).toBe('4');
    expect(await head.text()).toBe('');
    expect((await request(asset, { headers: { range: 'bytes=9-' } })).status).toBe(416);
    expect((await request(asset, { headers: { 'if-match': '"stale"' } })).status).toBe(412);
    expect((await request(prefix + 'assets/secret.txt')).status).toBe(404);
    expect((await request(asset, { method: 'DELETE' })).status).toBe(405);
    expect((await request(prefix)).status).toBe(200);
    expect((await request(prefix + 'launcher.js')).status).toBe(200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
