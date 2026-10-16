import { test, expect } from 'bun:test';
import { openPackage, blockReader } from '../src';
import { xtsReader } from '../src/crypto';
import { decompress, readPfs } from '../src/pfs';
import { zlibSync } from 'fflate';
const memory = (bytes: Uint8Array) => ({
  size: bytes.length,
  read(offset: number, count: number) {
    if (offset < 0 || count < 0 || offset + count > bytes.length) throw Error('bounds');
    return bytes.slice(offset, offset + count);
  },
});
test('bounded reader joins blocks and rejects unsafe ranges', () => {
  const reader = blockReader(9, 4, (i) => new Uint8Array(Math.min(4, 9 - i * 4)).fill(i));
  expect(Array.from(reader.read(3, 6))).toEqual([0, 1, 1, 1, 1, 2]);
  for (const offset of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    expect(() => reader.read(offset, 4)).toThrow();
});
test('XTS matches independently generated OpenSSL vectors for both key derivations', () => {
  // OpenSSL AES-128-XTS, sector 0, plaintext bytes 0..63. No native crypto dependency in this test.
  const vectors = [
    '115328e060567077372737cfa67e48a0c05bb1873e167b324148c9fe5554c69807bf4f21116a7606f84509f961cf02871b531ef1d1484f871fb3a0b8336eb029',
    '0b58ef1b78db312cd13fb788d54a5f48f96ac10b3f41e373e439ffc3d5b7dd343d36c308a57ec2f7fe8aad09406e724e705204cac5e5118b6686faac8ca36d1a',
  ];
  vectors.forEach((hex, index) => {
    const ciphertext = new Uint8Array(Buffer.from(hex, 'hex'));
    const reader = xtsReader(
      memory(ciphertext),
      new Uint8Array(32).fill(7),
      new Uint8Array(16).fill(3),
      !!index,
      0,
    );
    expect(reader.read(0, 64)).toEqual(Uint8Array.from({ length: 64 }, (_, i) => i));
    const header = xtsReader(
      memory(ciphertext),
      new Uint8Array(32).fill(7),
      new Uint8Array(16).fill(3),
      !!index,
      1,
    );
    expect(header.read(0, 64)).toEqual(ciphertext);
  });
});
test('PFSC decompresses bounded sectors and rejects a descending offset table', () => {
  const plain = new Uint8Array(4096).fill(17),
    compressed = zlibSync(plain);
  const data = new Uint8Array(64 + compressed.length),
    v = new DataView(data.buffer);
  v.setUint32(0, 0x43534650, true);
  v.setUint32(12, 4096, true);
  v.setBigUint64(16, 4096n, true);
  v.setBigUint64(24, 48n, true);
  v.setBigUint64(40, 4096n, true);
  v.setBigUint64(48, 64n, true);
  v.setBigUint64(56, BigInt(data.length), true);
  data.set(compressed, 64);
  expect(decompress(memory(data)).read(0, 4096)).toEqual(plain);
  v.setBigUint64(56, 63n, true);
  expect(() => decompress(memory(data)).read(0, 10)).toThrow();
});
test('malformed PKG/PFS inputs fail before allocation or traversal', () => {
  expect(() => openPackage(memory(new Uint8Array(0x430)))).toThrow('PS4');
  const bytes = new Uint8Array(0x430);
  new DataView(bytes.buffer).setUint32(0, 0x7f434e54);
  new DataView(bytes.buffer).setUint32(16, 0xffffffff);
  expect(() => openPackage(memory(bytes))).toThrow('table');
  expect(() => readPfs(memory(new Uint8Array(0x400)))).toThrow('PFS');
});
