import { readFile, writeFile, rename, rm, chmod, mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractor } from '../lib/resources';
import { reply, error } from '../http/responses';
async function* readBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
export const maxPackage = 8 * 1024 ** 3;
export async function createLibrary(root: string) {
  let active: string | null = null;
  try {
    const metadata: unknown = JSON.parse(await readFile(join(root, 'library.json'), 'utf8'));
    if (
      typeof metadata === 'object' &&
      metadata !== null &&
      'id' in metadata &&
      typeof metadata.id === 'string' &&
      /^[a-f0-9-]{36}$/.test(metadata.id)
    )
      active = metadata.id;
  } catch {}
  let state = active ? 'ready' : 'empty',
    message = '',
    busy = false,
    child: ReturnType<typeof Bun.spawn> | null = null;

  const runtime = await mkdtemp(join(root, '.runtime-'));
  let extractorPath: string | null = null;
  async function prepareExtractor() {
    if (extractorPath) return extractorPath;
    const target = join(runtime, 'PT.MacExtract');
    await Bun.write(target, Bun.file(extractor));
    await chmod(target, 0o700);
    extractorPath = target;
    return target;
  }
  async function importPkg(request: Request) {
    if (request.headers.get('content-type') !== 'application/octet-stream')
      return error('Invalid file type.', 415);
    const length = Number(request.headers.get('content-length'));
    if (!Number.isSafeInteger(length) || length < 4096 || length > maxPackage)
      return error('Invalid PKG size (maximum 8 GiB).', 413);
    if (busy) return error('An import is already in progress.', 409);
    busy = true;
    const id = randomUUID(),
      upload = join(root, 'upload-' + id + '.pkg'),
      destination = join(root, id),
      pointer = join(root, 'pointer-' + id + '.json');
    let committed = false;
    try {
      state = 'uploading';
      message = 'Receiving the PKG…';
      let received = 0;
      const counter = new Transform({
        transform(chunk, encoding, cb) {
          received += chunk.length;
          cb(received > length ? new Error('Received size does not match.') : null, chunk);
        },
      });
      if (!request.body) throw new Error('Empty request.');
      await pipeline(
        Readable.from(readBody(request.body)),
        counter,
        createWriteStream(upload, { flags: 'wx', mode: 0o600 }),
      );
      if (received !== length) throw new Error('Incomplete transfer.');
      state = 'extracting';
      message = 'Extracting and verifying files…';
      const helper = await prepareExtractor();
      child = Bun.spawn([helper, upload, destination], {
        env: { ...process.env, DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(runtime, 'bundle') },
        stdout: 'ignore',
        stderr: 'pipe',
      });
      // The helper's diagnostics are small; no game data is written to stderr.
      const stderr = new Response(child.stderr as ReadableStream<Uint8Array>).text();
      const code = await child.exited,
        detail = await stderr;
      child = null;
      if (code !== 0) {
        console.error('PKG extraction failed:', detail.trim().slice(-2000));
        throw new Error(
          'Could not extract the PKG. Check that it is a complete, compatible fPKG and try again.',
        );
      }
      await writeFile(pointer, JSON.stringify({ id }), { flag: 'wx', mode: 0o600 });
      await rename(pointer, join(root, 'library.json'));
      committed = true;
      active = id;
      state = 'ready';
      message = 'Import complete.';
      return reply({ state });
    } catch (e) {
      state = active ? 'ready' : 'empty';
      message = e instanceof Error ? e.message : String(e);
      return error(message, 400);
    } finally {
      child = null;
      await rm(upload, { force: true });
      await rm(pointer, { force: true });
      if (!committed) await rm(destination, { recursive: true, force: true });
      busy = false;
    }
  }
  return {
    get active() {
      return active;
    },
    get status() {
      return { state, message };
    },
    importPkg,
    async dispose() {
      child?.kill();
      if (child) await child.exited;
      await rm(runtime, { recursive: true, force: true });
    },
  };
}
