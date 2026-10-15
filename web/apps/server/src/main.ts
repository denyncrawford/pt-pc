// SPDX-License-Identifier: MIT
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { error } from './http/responses';
import { createApp } from './app';
import { createLibrary, maxPackage } from './services/library';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'PT.BunHost [--data <directory>] [--no-browser]\nBun server with extraction helper. Web port in development; full gameplay is not yet available.',
  );
  process.exit(0);
}
const dataIndex = args.indexOf('--data');
if (dataIndex >= 0 && !args[dataIndex + 1]) throw new Error('Missing directory for --data');
const root = resolve(
  dataIndex >= 0
    ? args[dataIndex + 1]
    : join(homedir(), 'Library', 'Application Support', 'PT.BunHost'),
);
await mkdir(root, { recursive: true });
// The exclusive process lock prevents two hosts from changing the same library.
const lockPath = join(root, '.bun-host.lock');
try {
  const f = await open(lockPath, 'wx', 0o600);
  await f.writeFile(String(process.pid));
  await f.close();
} catch {
  try {
    const existing = (await readFile(join(root, 'session-url.txt'), 'utf8')).trim();
    if (!/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/$/.test(existing))
      throw new Error('Invalid URL');
    const response = await fetch(existing + 'api/status', { signal: AbortSignal.timeout(1500) });
    const status: unknown = await response.json();
    if (
      !response.ok ||
      typeof status !== 'object' ||
      status === null ||
      !('backend' in status) ||
      status.backend !== 'bun'
    )
      throw new Error('Server is not running');
    console.log('Already running: ' + existing);
    if (!args.includes('--no-browser'))
      await Bun.spawn(['open', existing], { stdout: 'ignore', stderr: 'ignore' }).exited;
    process.exit(0);
  } catch {
    console.error(
      'The library is in use, or a lock remains after an unexpected shutdown: ' + lockPath,
    );
    process.exit(1);
  }
}
process.on('exit', () => {
  try {
    require('node:fs').unlinkSync(lockPath);
  } catch {}
});
const library = await createLibrary(root);
const token = randomBytes(24).toString('hex'),
  prefix = '/' + token + '/';
const app = createApp({
  root,
  prefix,
  library,
  serverUrl: () => server.url,
  disableUploadTimeout: (request) => server.timeout(request, 0),
});
const server: Bun.Server<undefined> = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  maxRequestBodySize: maxPackage,
  idleTimeout: 255,
  fetch: app.fetch,
  error(e) {
    console.error(e.message);
    return error('Server error.', 500);
  },
});
const url = server.url.origin + prefix;
await writeFile(join(root, 'session-url.txt'), url, { mode: 0o600 });
console.log('PT_WEB_URL=' + url);
console.log('Bun server ' + Bun.version + ' · Library: ' + root + '\nCtrl+C to stop.');
if (!args.includes('--no-browser')) {
  const opener = Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'pipe' });
  if ((await opener.exited) !== 0) console.error('Open the URL above in your browser.');
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await library.dispose();
  await server.stop(true);
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
