// Optional private acceptance check. No fixture or output is copied into the repository.
import { openSync, readSync, statSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { blockReader, openPackage } from '../../web/packages/pkg-extractor/src';
const [pkg, expected] = process.argv.slice(2);
if (!pkg || !expected)
  throw new Error(
    'Usage: bun tools/web/verify-local-extractor.ts <private.pkg> <native-extraction-directory>',
  );
const fd = openSync(pkg, 'r');
try {
  const size = statSync(pkg).size,
    block = 1024 * 1024;
  const reader = blockReader(
    size,
    block,
    (index) => {
      const bytes = new Uint8Array(Math.min(block, size - index * block));
      if (readSync(fd, bytes, 0, bytes.length, index * block) !== bytes.length)
        throw new Error('Short read');
      return bytes;
    },
    4,
  );
  for (const file of openPackage(reader)) {
    const digest = createHash('sha256');
    for (let offset = 0; offset < file.size; offset += block)
      digest.update(new Uint8Array(await file.slice(offset, offset + block).arrayBuffer()));
    const actual = digest.digest('hex'),
      reference = createHash('sha256');
    for await (const chunk of Bun.file(resolve(expected, file.name)).stream())
      reference.update(chunk);
    if (actual !== reference.digest('hex')) throw new Error('Extraction mismatch: ' + file.name);
    console.log(file.name + ': SHA-256 matches native extraction');
  }
} finally {
  closeSync(fd);
}
