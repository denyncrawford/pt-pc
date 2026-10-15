// MIT. Bounded HTTP range cache; same interface as a browser File.
export interface RangeArchive {
  name: string;
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
export async function remoteArchive(
  base: string | URL,
  name: string = 'chunk1.psarc',
): Promise<RangeArchive> {
  const url = new URL('assets/' + name, base);
  const r = await fetch(url, { method: 'HEAD' });
  if (!r.ok) throw new Error('No PSARC is available.');
  const size = Number(r.headers.get('Content-Length')),
    etag = r.headers.get('ETag');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid file size.');
  const cache = new Map<number, Uint8Array<ArrayBuffer>>(),
    blockSize = 4 * 1024 * 1024;
  async function block(index: number): Promise<Uint8Array<ArrayBuffer>> {
    if (cache.has(index)) {
      const value = cache.get(index)!;
      cache.delete(index);
      cache.set(index, value);
      return value;
    }
    const start = index * blockSize,
      end = Math.min(start + blockSize, size);
    const result = await fetch(url, {
      headers: { Range: `bytes=${start}-${end - 1}`, ...(etag ? { 'If-Match': etag } : {}) },
    });
    if (result.status !== 206)
      throw new Error('Could not read the range (' + result.status + '). Reopen the library.');
    if (result.headers.get('Content-Range') !== `bytes ${start}-${end - 1}/${size}`)
      throw new Error('Invalid range response.');
    const bytes = new Uint8Array(await result.arrayBuffer());
    if (bytes.length !== end - start) throw new Error('Incomplete read.');
    cache.set(index, bytes);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return bytes;
  }
  return {
    name,
    size,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => {
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          end > size ||
          end - start > 128 * 1024 * 1024
        )
          throw new Error('Invalid range.');
        const out = new Uint8Array(end - start);
        let position = start;
        while (position < end) {
          const index = Math.floor(position / blockSize),
            bytes = await block(index),
            offset = position - index * blockSize,
            count = Math.min(end - position, bytes.length - offset);
          out.set(bytes.subarray(offset, offset + count), position - start);
          position += count;
        }
        return out.buffer;
      },
    }),
  };
}
