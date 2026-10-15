import { join } from 'node:path';
import { headers, error } from '../http/responses';
import { byteRange } from '../lib/range';
const assetNames = new Set(['chunk1.psarc', 'texture.qar', 'pathid_list_ps4.bin', 'manifest.json']);
export async function serveAsset(
  request: Request,
  path: string,
  root: string,
  id: string | null,
): Promise<Response> {
  const name = path.slice(7);
  if (!assetNames.has(name) || !id) return error('File not found.', 404);
  const file = Bun.file(join(root, id, name));
  if (!(await file.exists())) return error('File not found.', 404);
  const etag = '"' + id + '-' + name + '"';
  if (
    request.headers.has('if-match') &&
    request.headers.get('if-match') !== etag &&
    request.headers.get('if-match') !== '*'
  )
    return new Response(null, { status: 412, headers });
  const h = new Headers({
    ...headers,
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'Content-Type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
  });
  let range: [number, number] | null = null;
  try {
    range = request.method === 'GET' ? byteRange(request.headers.get('range'), file.size) : null;
  } catch {
    h.set('Content-Range', 'bytes */' + file.size);
    return new Response(null, { status: 416, headers: h });
  }
  if (range) {
    const [start, end] = range;
    h.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
    h.set('Content-Length', String(end - start + 1));
    return new Response(file.slice(start, end + 1), { status: 206, headers: h });
  }
  h.set('Content-Length', String(file.size));
  return new Response(request.method === 'HEAD' ? null : file, { headers: h });
}
