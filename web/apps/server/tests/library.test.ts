import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLibrary } from '../src/services/library';

test('import service rejects malformed metadata and cleans a truncated upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pt-library-test-'));
  await writeFile(join(root, 'library.json'), JSON.stringify({ id: 123 }));
  const library = await createLibrary(root);
  try {
    expect(library.active).toBeNull();
    const response = await library.importPkg(
      new Request('http://localhost/api/pkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '4096' },
        body: new Uint8Array(128),
      }),
    );
    expect(response.status).toBe(400);
    expect(library.status.state).toBe('empty');
    expect(
      (await readdir(root)).filter(
        (name) => name.startsWith('upload-') || name.startsWith('pointer-'),
      ),
    ).toEqual([]);
    const retry = await library.importPkg(
      new Request('http://localhost/api/pkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '4096' },
        body: new Uint8Array(128),
      }),
    );
    expect(retry.status).toBe(400); // Failed imports must release the busy guard.
  } finally {
    await library.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
