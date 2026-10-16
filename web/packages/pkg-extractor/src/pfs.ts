// SPDX-License-Identifier: LGPL-3.0-or-later
// PFS/PFSC layouts adapted from LibOrbisPkg; see NOTICE.md.
import { inflateSync } from 'fflate';
import { blockReader, checkRange, subReader, u64, view, type Reader } from './reader';
import { xtsReader } from './crypto';
export interface ArchiveEntry {
  name: string;
  path: string;
  size: number;
  reader: Reader;
}
export function decompress(source: Reader): Reader {
  const h = source.read(0, 48),
    d = view(h),
    block = d.getUint32(12, true),
    size = u64(h, 40);
  if (
    d.getUint32(0, true) !== 0x43534650 ||
    d.getUint32(4, true) !== 0 ||
    block !== u64(h, 16) ||
    block < 512 ||
    block > 1024 * 1024 ||
    size % block
  )
    throw new Error('Unsupported PFSC header.');
  const count = size / block;
  if (count > 2_000_000) throw new Error('PFSC image is too large.');
  const map = source.read(u64(h, 24), (count + 1) * 8);
  return blockReader(size, block, (index) => {
    const start = u64(map, index * 8),
      length = u64(map, (index + 1) * 8) - start;
    if (length < 0) throw new Error('Invalid PFSC sector map.');
    if (length === block) return source.read(start, block);
    // PFSC uses an oversized span to represent a zero-filled block.
    if (length > block) return new Uint8Array(block);
    if (length < 2) throw new Error('Invalid compressed sector.');
    const result = inflateSync(source.read(start + 2, length - 2), { out: new Uint8Array(block) });
    if (result.length !== block) throw new Error('Invalid decompressed sector size.');
    return new Uint8Array(result);
  });
}
interface Inode {
  size: number;
  count: number;
  direct: number[];
  indirect: number[];
}
export function readPfs(input: Reader, key?: Uint8Array, newCrypt = false): ArchiveEntry[] {
  const h = input.read(0, 0x400),
    d = view(h),
    mode = d.getUint16(28, true),
    block = d.getUint32(32, true);
  if (u64(h, 0) !== 1 || u64(h, 8) !== 20130315 || mode & 2 || block !== 0x10000)
    throw new Error('Unsupported PFS format.');
  let source = input;
  if (mode & 4) {
    if (!key) throw new Error('Missing fPKG image key.');
    source = xtsReader(input, key, h.slice(0x370, 0x380), newCrypt, block / 4096);
  }
  const signed = !!(mode & 1),
    inodeSize = signed ? 0x2c8 : 0xa8,
    perBlock = Math.floor(block / inodeSize),
    count = u64(h, 48),
    inodeBlocks = u64(h, 64);
  if (count < 1 || count > 100_000 || inodeBlocks * perBlock < count || inodeBlocks > 10000)
    throw new Error('Invalid PFS inode table.');
  const inodes: Inode[] = [];
  for (let i = 0; i < inodeBlocks && inodes.length < count; i++) {
    const data = source.read(block * (i + 1), block);
    for (let j = 0; j < perBlock && inodes.length < count; j++) {
      const b = data.subarray(j * inodeSize, (j + 1) * inodeSize),
        v = view(b),
        stride = signed ? 36 : 4,
        start = 100 + (signed ? 32 : 0);
      const pointers = Array.from({ length: 17 }, (_, n) => v.getInt32(start + n * stride, true));
      inodes.push({
        size: u64(b, 8),
        count: v.getUint32(96, true),
        direct: pointers.slice(0, 12),
        indirect: pointers.slice(12),
      });
    }
  }
  function fileReader(ino: Inode): Reader {
    if (ino.size === 0) return subReader(source, 0, 0);
    if (ino.count < 1 || ino.count > Math.ceil(source.size / block) || ino.size > ino.count * block)
      throw new Error('Invalid PFS file size.');
    if (ino.count === 1 || ino.direct[1] === -1)
      return subReader(source, ino.direct[0]! * block, ino.size);
    if (!signed) throw new Error('Unsupported fragmented unsigned PFS file.');
    const pointers = ino.direct.slice(0, Math.min(12, ino.count)),
      entries = Math.floor(block / 36);
    const pointerBlock = (number: number) => {
      if (number < 1) throw new Error('Invalid indirect block.');
      return source.read(number * block, block);
    };
    if (pointers.length < ino.count) {
      const single = pointerBlock(ino.indirect[0]!);
      for (let i = 0; i < entries && pointers.length < ino.count; i++)
        pointers.push(view(single).getInt32(i * 36 + 32, true));
    }
    if (pointers.length < ino.count) {
      const double = pointerBlock(ino.indirect[1]!);
      for (let j = 0; j < entries && pointers.length < ino.count; j++) {
        const single = pointerBlock(view(double).getInt32(j * 36 + 32, true));
        for (let i = 0; i < entries && pointers.length < ino.count; i++)
          pointers.push(view(single).getInt32(i * 36 + 32, true));
      }
    }
    if (pointers.length !== ino.count)
      throw new Error('PFS triple-indirect files are not supported.');
    return blockReader(ino.size, block, (index) =>
      source.read(pointers[index]! * block, Math.min(block, ino.size - index * block)),
    );
  }
  const result: ArchiveEntry[] = [],
    seen = new Set<number>();
  function directory(number: number, path: string, depth: number) {
    if (depth > 32 || seen.has(number) || seen.size > 10000)
      throw new Error('Invalid PFS directory tree.');
    seen.add(number);
    const ino = inodes[number];
    if (!ino || ino.count < 1 || ino.count > 1024) throw new Error('Invalid PFS directory.');
    const start = ino.direct[0]!;
    checkRange(source.size, start * block, ino.count * block);
    for (let n = 0; n < ino.count; n++) {
      const bytes = source.read((start + n) * block, block),
        v = view(bytes);
      for (let p = 0; p + 16 <= block;) {
        const id = v.getUint32(p, true),
          type = v.getInt32(p + 4, true),
          length = v.getInt32(p + 8, true),
          size = v.getInt32(p + 12, true);
        if (size === 0) break;
        if (size < 16 || size > block - p || length < 0 || length > size - 16 || length > 255)
          throw new Error('Invalid PFS directory entry.');
        const name = new TextDecoder()
          .decode(bytes.subarray(p + 16, p + 16 + length))
          .replace(/\0.*$/, '');
        if (type === 2 || type === 3) {
          if (!name || name === '.' || name === '..' || /[\\/]/.test(name))
            throw new Error('Invalid PFS entry name.');
          const full = path + '/' + name;
          if (type === 3) {
            if (name !== 'sce_sys' && name !== 'sce_module') directory(id, full, depth + 1);
          } else {
            const item = inodes[id];
            if (!item) throw new Error('Missing PFS inode.');
            result.push({ name, path: full, size: item.size, reader: fileReader(item) });
          }
        }
        p += size;
      }
    }
  }
  directory(0, '', 0);
  return result.filter((item) => item.path.startsWith('/uroot/'));
}
