import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const fixtures = () => {
  const psarc = Buffer.alloc(4 * 1024 * 1024 + 17, 42);
  psarc.write('PSAR');
  const qar = Buffer.alloc(128, 31);
  qar[qar.length - 0x24 + 0x16] = 0x61;
  qar[qar.length - 0x24 + 0x17] = 0x71;
  return [
    { name: 'chunk1.psarc', mimeType: 'application/octet-stream', buffer: psarc },
    { name: 'texture.qar', mimeType: 'application/octet-stream', buffer: qar },
    {
      name: 'pathid_list_ps4.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fixture/pt14_hallway'),
    },
  ];
};

test('static launcher imports bounded local files, survives reload and never calls the backend', async ({
  page,
}) => {
  const backend: string[] = [];
  page.on('request', (request) => {
    if (/\/(api|assets)\//.test(request.url())) backend.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('Import your copy', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(fixtures());
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const { openLocalLibrary } = await import('/local-library.js');
    const library = await openLocalLibrary();
    return Array.from(
      new Uint8Array(
        await library.archive.slice(2 * 1024 * 1024 - 2, 2 * 1024 * 1024 + 3).arrayBuffer(),
      ),
    );
  });
  expect(bytes).toEqual([42, 42, 42, 42, 42]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const broken = fixtures();
  broken[0].buffer.write('FAIL');
  await page.locator('input[type=file]').setInputFiles(broken);
  await expect(page.getByRole('alert')).toContainText('not compatible');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(backend).toEqual([]);
});

test('cancellation preserves the committed library and removes partial data', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fixtures());
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { openLocalLibrary, importLocalLibrary } = await import('/local-library.js');
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('pt-local-library-v1');
    const before = await (await root.getFileHandle('active.json')).getFile().then((f) => f.text());
    const local = await openLocalLibrary();
    const paths = new File(['pt14_test'], 'pathid_list_ps4.bin');
    const controller = new AbortController();
    let failed = false;
    try {
      await importLocalLibrary(
        [local.archive, local.textures, paths],
        () => controller.abort(),
        controller.signal,
      );
    } catch {
      failed = true;
    }
    const after = await (await root.getFileHandle('active.json')).getFile().then((f) => f.text());
    const entries = [];
    for await (const name of root.keys()) entries.push(name);
    return { failed, same: before === after, entries: entries.length };
  });
  expect(result).toEqual({ failed: true, same: true, entries: 2 });
});

test('private real library loads the hallway engine entirely from OPFS', async ({ page }) => {
  test.skip(
    !process.env.PT_TEST_LIBRARY,
    'Optional private assets are never included in fixtures.',
  );
  test.setTimeout(240_000);
  const backend: string[] = [];
  page.on('request', (r) => {
    if (/\/(api|assets)\//.test(r.url())) backend.push(r.url());
  });
  // Headless incognito profiles can impose a small quota independent of disk space.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', {
    origin: 'http://127.0.0.1:4175',
    quotaSize: 4 * 1024 ** 3,
  });
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles(
      ['chunk1.psarc', 'texture.qar', 'pathid_list_ps4.bin'].map((name) =>
        resolve(process.env.PT_TEST_LIBRARY!, name),
      ),
    );
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }).or(page.getByRole('alert')),
  ).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.reload();
  const scene = await page.evaluate(async () => {
    const { openLocalLibrary } = await import('/local-library.js');
    const { loadHallway } = await import('/runtime.js');
    const { default: create } = await import('/geometry.js');
    const local = await openLocalLibrary();
    const wasm = await create();
    const hallway = await loadHallway(wasm, local.archive);
    return {
      vertices: hallway.vertices.length,
      indices: hallway.indices.length,
      collision: hallway.collisionCount,
    };
  });
  expect(scene.vertices).toBeGreaterThan(0);
  expect(scene.indices).toBeGreaterThan(0);
  expect(scene.collision).toBeGreaterThan(0);
  expect(backend).toEqual([]);
});

test('local save survives library import and reload; reset is explicit', async ({ page }) => {
  await page.goto('/');
  const saved = await page.evaluate(async () => {
    const { SaveGameStore } = await import('/save-game.js');
    new SaveGameStore(localStorage).write({ floor: 'f040', photoWord: 0x10c });
    return localStorage.getItem('pt-web-progress');
  });
  await page.locator('input[type=file]').setInputFiles(fixtures());
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('pt-web-progress'))).toBe(saved);
  const reset = await page.evaluate(async () => {
    const { SaveGameStore } = await import('/save-game.js');
    const store = new SaveGameStore(localStorage);
    store.reset();
    return store.read();
  });
  expect(reset?.floor).toBe('f000');
});

test('private PKG extracts in a Worker and loads the real hallway without a backend', async ({
  page,
}) => {
  test.skip(!process.env.PT_TEST_PKG, 'Optional private fPKG is never distributed.');
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', {
    origin: 'http://127.0.0.1:4175',
    quotaSize: 4 * 1024 ** 3,
  });
  const forbidden: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || /\/(api|assets)\//.test(r.url())) forbidden.push(r.url());
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(process.env.PT_TEST_PKG!);
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }).or(page.getByRole('alert')),
  ).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  const result = await page.evaluate(async () => {
    const { openLocalLibrary } = await import('/local-library.js');
    const { loadHallway } = await import('/runtime.js');
    const { default: create } = await import('/geometry.js');
    const library = await openLocalLibrary();
    const scene = await loadHallway(await create(), library.archive);
    return {
      archive: library.archive.size,
      textures: library.textures.size,
      collision: scene.collisionCount,
    };
  });
  expect(result.archive).toBeGreaterThan(0);
  expect(result.textures).toBeGreaterThan(0);
  expect(result.collision).toBeGreaterThan(0);
  expect(forbidden).toEqual([]);
});
