// SPDX-License-Identifier: LGPL-3.0-or-later
export interface Reader {
  readonly size: number;
  read(offset: number, count: number): Uint8Array<ArrayBuffer>;
}
export function checkRange(size: number, offset: number, count: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(count) ||
    offset < 0 ||
    count < 0 ||
    offset > size - count
  )
    throw new Error('Truncated or invalid package range.');
}
export function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
export function u64(bytes: Uint8Array, offset: number, little = true) {
  const value = view(bytes).getBigUint64(offset, little);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Package offset is too large.');
  return Number(value);
}
export function subReader(source: Reader, start: number, size: number): Reader {
  checkRange(source.size, start, size);
  return {
    size,
    read(offset, count) {
      checkRange(size, offset, count);
      return source.read(start + offset, count);
    },
  };
}
/** Small bounded cache: repeated filesystem metadata reads never reread the PKG. */
export function blockReader(
  size: number,
  blockSize: number,
  load: (index: number) => Uint8Array<ArrayBuffer>,
  capacity = 8,
): Reader {
  const cache = new Map<number, Uint8Array<ArrayBuffer>>();
  return {
    size,
    read(offset, count) {
      checkRange(size, offset, count);
      const output = new Uint8Array(count);
      for (let done = 0; done < count;) {
        const index = Math.floor((offset + done) / blockSize),
          within = (offset + done) % blockSize;
        let block = cache.get(index);
        if (!block) {
          block = load(index);
          if (block.length !== Math.min(blockSize, size - index * blockSize))
            throw new Error('Invalid package block length.');
          if (cache.size >= capacity) cache.delete(cache.keys().next().value!);
          cache.set(index, block);
        }
        const n = Math.min(count - done, block.length - within);
        output.set(block.subarray(within, within + n), done);
        done += n;
      }
      return output;
    },
  };
}
