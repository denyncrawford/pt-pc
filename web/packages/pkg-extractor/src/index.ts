// SPDX-License-Identifier: LGPL-3.0-or-later
import { imageKey } from './crypto';
import { decompress, readPfs, type ArchiveEntry } from './pfs';
import { subReader, u64, view, type Reader } from './reader';
export type { Reader } from './reader';
export { blockReader } from './reader';
export interface ExtractedSource {
  name: string;
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
/** Reads only the three game archives. Never writes package-provided paths. */
export function openPackage(source: Reader): ExtractedSource[] {
  const h = source.read(0, 0x430),
    d = view(h);
  if (d.getUint32(0) !== 0x7f434e54) throw new Error('This is not a PS4 PKG.');
  const count = d.getUint32(0x10),
    table = d.getUint32(0x18);
  if (count < 1 || count > 10000) throw new Error('Invalid PKG entry table.');
  const metas = source.read(table, count * 32);
  function meta(id: number) {
    for (let i = 0; i < count; i++) {
      const entry = metas.slice(i * 32, (i + 1) * 32);
      if (view(entry).getUint32(0) === id) return entry;
    }
    throw new Error('Missing fPKG key metadata.');
  }
  const keys = meta(0x10),
    image = meta(0x20);
  if (view(keys).getUint32(20) !== 2048 || view(image).getUint32(20) !== 256)
    throw new Error('Unsupported fPKG key metadata.');
  const key = imageKey(
    source.read(view(keys).getUint32(16) + 256 + 3 * 256, 256),
    image,
    source.read(view(image).getUint32(16), 256),
  );
  const pfs = subReader(source, u64(h, 0x410, false), u64(h, 0x418, false));
  const outer = readPfs(pfs, key, !!(d.getBigUint64(0x408) & 0x2000000000000000n));
  const inner = outer.find((file) => file.path === '/uroot/pfs_image.dat');
  if (!inner) throw new Error('Missing inner PFS image.');
  const files = readPfs(decompress(inner.reader));
  function choose(
    name: string,
    kind: (f: ArchiveEntry) => boolean,
    valid: (f: ArchiveEntry) => boolean,
  ) {
    const exact = files.find((f) => f.path === '/uroot/' + name && valid(f));
    const file =
      exact ?? files.filter((f) => kind(f) && valid(f)).sort((a, b) => b.size - a.size)[0];
    if (!file || file.size < 1 || file.size > 4 * 1024 ** 3)
      throw new Error('Required P.T. archive not found: ' + name);
    return {
      name,
      size: file.size,
      slice(start = 0, end = file.size) {
        const begin = start < 0 ? Math.max(0, file.size + start) : Math.min(start, file.size);
        const finish = end < 0 ? Math.max(0, file.size + end) : Math.min(end, file.size);
        return {
          async arrayBuffer() {
            return file.reader.read(begin, Math.max(0, finish - begin)).buffer;
          },
        };
      },
    };
  }
  return [
    choose(
      'chunk1.psarc',
      (f) => f.name.toLowerCase().endsWith('.psarc'),
      (f) => f.size >= 4 && view(f.reader.read(0, 4)).getUint32(0) === 0x50534152,
    ),
    choose(
      'texture.qar',
      (f) => f.name.toLowerCase().endsWith('.qar'),
      (f) => {
        if (f.size < 36) return false;
        const footer = f.reader.read(f.size - 36, 36);
        return footer[22] === 97 && footer[23] === 113;
      },
    ),
    choose(
      'pathid_list_ps4.bin',
      (f) => f.name.toLowerCase().includes('pathid_list'),
      (f) => f.size >= 32 && f.size < 64 * 1024 ** 2,
    ),
  ];
}
