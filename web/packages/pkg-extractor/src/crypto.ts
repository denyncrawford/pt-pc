// SPDX-License-Identifier: LGPL-3.0-or-later
// fPKG and XTS layout adapted from LibOrbisPkg; see NOTICE.md.
import { cbc, ecb } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { FakeKeyset, PkgDerivedKey3Keyset } from './fpkg-keys';
import { blockReader, type Reader } from './reader';
function rsa(ciphertext: Uint8Array, key: { n: bigint; d: bigint }) {
  if (ciphertext.length !== 256) throw new Error('Invalid fPKG key length.');
  let base = 0n;
  for (const b of ciphertext) base = (base << 8n) | BigInt(b);
  if (base >= key.n) throw new Error('Invalid fPKG key.');
  let exponent = key.d,
    result = 1n;
  while (exponent) {
    if (exponent & 1n) result = (result * base) % key.n;
    base = (base * base) % key.n;
    exponent >>= 1n;
  }
  const bytes = new Uint8Array(256);
  for (let i = 255; i >= 0; i--) {
    bytes[i] = Number(result & 255n);
    result >>= 8n;
  }
  let end = 2;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (bytes[0] !== 0 || bytes[1] !== 2 || end < 10 || end >= 255)
    throw new Error('Unsupported retail or damaged PKG. Use an fPKG from your own dump.');
  return bytes.slice(end + 1);
}
export function imageKey(derived: Uint8Array, metadata: Uint8Array, encrypted: Uint8Array) {
  const dk = rsa(derived, PkgDerivedKey3Keyset);
  const combined = new Uint8Array(metadata.length + dk.length);
  combined.set(metadata);
  combined.set(dk, metadata.length);
  const digest = sha256(combined);
  const decoded = cbc(digest.slice(16), digest.slice(0, 16), { disablePadding: true }).decrypt(
    encrypted,
  );
  const key = rsa(decoded, FakeKeyset);
  if (key.length !== 32) throw new Error('Invalid image key.');
  return key;
}
export function xtsReader(
  source: Reader,
  key: Uint8Array,
  seed: Uint8Array,
  newCrypt: boolean,
  startSector: number,
): Reader {
  const input = new Uint8Array(20);
  input[0] = 1;
  input.set(seed, 4);
  const derived = hmac(sha256, newCrypt ? hmac(sha256, key, seed) : key, input);
  const tweakKey = derived.slice(0, 16),
    dataKey = derived.slice(16);
  return blockReader(
    source.size,
    4096,
    (index) => {
      const bytes = source.read(index * 4096, Math.min(4096, source.size - index * 4096));
      if (index < startSector) return bytes;
      const number = new Uint8Array(16);
      new DataView(number.buffer).setBigUint64(0, BigInt(index), true);
      const tweak = ecb(tweakKey, { disablePadding: true }).encrypt(number);
      const masks = new Uint8Array(bytes.length);
      for (let p = 0; p < bytes.length; p += 16) {
        masks.set(tweak, p);
        for (let j = 0; j < 16; j++) bytes[p + j] = bytes[p + j]! ^ tweak[j]!;
        let carry = 0;
        for (let j = 0; j < 16; j++) {
          const value = tweak[j]!;
          tweak[j] = ((value << 1) | carry) & 255;
          carry = value >>> 7;
        }
        if (carry) tweak[0] = tweak[0]! ^ 0x87;
      }
      const result = ecb(dataKey, { disablePadding: true }).decrypt(bytes);
      for (let i = 0; i < result.length; i++) result[i] = result[i]! ^ masks[i]!;
      return result;
    },
    32,
  );
}
