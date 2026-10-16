import { createHash } from 'node:crypto';

/** Hash the complete runtime graph: external imports and WASM must share a revision. */
export function fingerprintRuntime(files: ReadonlyMap<string, Uint8Array>) {
  const names = [...files.keys()].filter((name) => /\.(js|css|wasm)$/.test(name)).sort();
  const hash = createHash('sha256');
  for (const name of names) {
    const bytes = files.get(name)!;
    hash.update(`${name}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  const revision = hash.digest('hex').slice(0, 20);
  const renamed = new Map(
    names.map((name) => [name, name.replace(/\.(js|css|wasm)$/, `-${revision}.$1`)]),
  );
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const references = new RegExp(`(?<![\\w.-])(?:${escaped.join('|')})(?![\\w.-])`, 'g');
  const output = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    const content = /\.(js|css|html)$/.test(name)
      ? new TextEncoder().encode(
          new TextDecoder().decode(bytes).replace(references, (match) => renamed.get(match)!),
        )
      : bytes;
    output.set(renamed.get(name) ?? name, content);
  }
  return { revision, renamed, files: output };
}
