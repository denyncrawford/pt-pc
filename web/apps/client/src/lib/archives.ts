// Browser-local, bounded reads. No network requests for user assets.
export interface ArchiveSource {
  name?: string;
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
interface ArchiveEntry {
  name: string;
  offset: number;
  size: number;
}
interface Fpk {
  bytes: Uint8Array;
  entries: ArchiveEntry[];
  references: string[];
}
interface PsarcEntry {
  block: number;
  size: number;
  offset: number;
}
export interface ModelSource {
  name: string;
  read(): Promise<Uint8Array>;
}
export const MAX_ENTRY = 128 * 1024 * 1024;
const text = new TextDecoder();
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function region(bytes: Uint8Array, offset: number, length: number) {
  check(
    Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= bytes.length,
    'Archivo truncado o índice inválido',
  );
  return bytes.subarray(offset, offset + length);
}
export async function readSlice(file: ArchiveSource, offset: number, length: number) {
  check(
    length <= MAX_ENTRY && offset >= 0 && offset + length <= file.size,
    'Lectura fuera de rango o demasiado grande',
  );
  const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  check(bytes.length === length, 'Lectura incompleta');
  return bytes;
}
export function unwrap(bytes: Uint8Array) {
  check(bytes.length >= 8, 'Archivo demasiado corto');
  let d = view(bytes),
    magic = d.getUint32(0, true);
  if (magic !== 0xa0f8efe6 && magic !== 0xe3f8efe6) return bytes;
  const key = d.getUint32(4, true),
    step = Math.imul(278, key);
  let blockKey = (key | ((key ^ 25974) << 16)) >>> 0;
  bytes = region(
    bytes,
    magic === 0xa0f8efe6 ? 8 : 16,
    bytes.length - (magic === 0xa0f8efe6 ? 8 : 16),
  ).slice();
  d = view(bytes);
  for (let p = 0; p + 4 <= bytes.length; p += 4) {
    d.setUint32(p, d.getUint32(p, true) ^ blockKey, true);
    blockKey = (step + Math.imul(48828125, blockKey)) >>> 0;
  }
  return bytes;
}
export function parseFpk(raw: Uint8Array) {
  const bytes = unwrap(raw),
    d = view(bytes);
  check(bytes.length >= 48 && text.decode(bytes.subarray(0, 6)) === 'foxfpk', 'FPK no válido');
  const count = d.getUint32(36, true),
    refs = d.getUint32(40, true);
  check(
    count <= 100000 && refs <= 100000 && 48 + count * 48 + refs * 16 <= bytes.length,
    'Tabla FPK no válida',
  );
  function nameAt(p: number) {
    return text.decode(region(bytes, d.getUint32(p, true), d.getUint32(p + 8, true)));
  }
  const entries: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    const p = 48 + i * 48,
      offset = d.getUint32(p, true),
      size = d.getUint32(p + 8, true);
    region(bytes, offset, size);
    entries.push({ name: nameAt(p + 16), offset, size });
  }
  const references = Array.from({ length: refs }, (_, i) => nameAt(48 + count * 48 + i * 16));
  return { bytes, entries, references };
}
export function fpkEntry(pkg: Fpk, name: string) {
  const entry = pkg.entries.find((e) => e.name === name);
  check(entry, 'Entrada FPK ausente');
  const bytes = region(pkg.bytes, entry.offset, entry.size);
  return bytes;
}
export class Psarc {
  declare file: ArchiveSource;
  names = new Map<string, number>();
  blockSize = 0;
  entries: PsarcEntry[] = [];
  blocks: number[] = [];

  constructor(file: ArchiveSource) {
    this.file = file;
    this.names = new Map();
  }
  async open() {
    const header = await readSlice(this.file, 0, 32),
      d = view(header);
    check(
      text.decode(header.subarray(0, 4)) === 'PSAR' &&
        text.decode(header.subarray(8, 12)) === 'zlib',
      'Se requiere un PSARC zlib',
    );
    const tocLength = d.getUint32(12),
      entrySize = d.getUint32(16),
      count = d.getUint32(20);
    this.blockSize = d.getUint32(24);
    check(
      tocLength >= 32 &&
        entrySize >= 30 &&
        count > 0 &&
        count <= 1000000 &&
        this.blockSize > 0 &&
        this.blockSize <= 1048576,
      'Cabecera PSARC no válida',
    );
    const toc = await readSlice(this.file, 32, tocLength - 32),
      t = view(toc);
    check(count * entrySize <= toc.length, 'Tabla PSARC truncada');
    const be = (p: number, n: number) => {
      let v = 0;
      for (const b of region(toc, p, n)) v = v * 256 + b;
      return v;
    };
    this.entries = Array.from({ length: count }, (_, i) => {
      const p = i * entrySize;
      return { block: t.getUint32(p + 16), size: be(p + 20, 5), offset: be(p + 25, 5) };
    });
    let width = 2;
    while (2 ** (width * 8) < this.blockSize) width++;
    this.blocks = [];
    for (let p = count * entrySize; p + width <= toc.length; p += width)
      this.blocks.push(be(p, width));
    const names = text
      .decode(await this.readIndex(0))
      .replaceAll('\r', '')
      .split('\n');
    for (let i = 1; i < count && i <= names.length; i++) this.names.set(names[i - 1]!, i);
    return this;
  }
  async readIndex(index: number) {
    const e = this.entries[index];
    check(e && e.size <= MAX_ENTRY, 'Entrada PSARC ausente o demasiado grande');
    const out = new Uint8Array(e.size);
    let cursor = e.offset,
      written = 0,
      block = e.block;
    while (written < e.size) {
      check(block < this.blocks.length, 'Índice de bloque PSARC inválido');
      const stored = this.blocks[block++] || this.blockSize,
        remaining = e.size - written;
      check(stored <= this.blockSize, 'Bloque PSARC demasiado grande');
      let bytes = await readSlice(this.file, cursor, stored);
      cursor += stored;
      if (!(stored === this.blockSize && remaining >= this.blockSize)) {
        // PSARC permits a raw final partial block. A non-zlib header denotes raw data.
        const zlib =
          bytes.length >= 2 && (bytes[0]! & 15) === 8 && ((bytes[0]! << 8) + bytes[1]!) % 31 === 0;
        if (zlib) {
          const reader = new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream('deflate'))
            .getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const r = await reader.read();
              if (r.done) break;
              size += r.value.length;
              check(size <= this.blockSize, 'Bloque descomprimido demasiado grande');
              chunks.push(r.value);
            }
          } finally {
            await reader.cancel();
          }
          bytes = new Uint8Array(size);
          let p = 0;
          for (const c of chunks) {
            bytes.set(c, p);
            p += c.length;
          }
        }
      }
      check(bytes.length > 0 && bytes.length <= remaining, 'Tamaño de bloque PSARC inválido');
      out.set(bytes, written);
      written += bytes.length;
    }
    return out;
  }
  read(name: string) {
    const id = this.names.get(name);
    check(id !== undefined, 'Paquete no encontrado: ' + name);
    return this.readIndex(id);
  }
}
export const archivePath = (name: string) =>
  name
    .replaceAll('\\', '/')
    .replace(/^\/Assets\//, 'as/')
    .replace(/^\/+/, '');
export async function discoverModels(
  files: Iterable<ArchiveSource & { name: string }>,
  progress: (message: string) => void = () => {},
) {
  const models: ModelSource[] = [];
  for (const file of files) {
    if (/\.fmdl$/i.test(file.name)) {
      models.push({ name: file.name, read: () => readSlice(file, 0, file.size) });
      continue;
    }
    let queue: string[],
      readPackage: (name: string) => Promise<Uint8Array>,
      archive: Psarc | undefined;
    if (/\.psarc$/i.test(file.name)) {
      archive = await new Psarc(file).open();
      queue = [...archive.names.keys()].filter((n) => /\/hallway\/.*\.fpkd?$/.test(n));
      check(queue.length, 'No se encontró el paquete hallway en este PSARC');
      readPackage = (name: string) => archive!.read(name);
    } else if (/\.fpkd?$/i.test(file.name)) {
      queue = [file.name];
      readPackage = () => readSlice(file, 0, file.size);
    } else continue;
    const visited = new Set<string>();
    while (queue.length) {
      const name = queue.shift()!;
      if (visited.has(name)) continue;
      check(visited.size < 128, 'Se alcanzó el límite de 128 paquetes');
      visited.add(name);
      progress('Leyendo ' + name);
      const pkg = parseFpk(await readPackage(name));
      for (const entry of pkg.entries.filter((e) => /\.fmdl$/i.test(e.name))) {
        const entryName = entry.name;
        models.push({
          name: entryName,
          read: async () => fpkEntry(parseFpk(await readPackage(name)), entryName),
        });
      }
      if (archive)
        for (const ref of pkg.references) {
          const p = archivePath(ref);
          if (archive.names.has(p) && /\.fpkd?$/.test(p) && !visited.has(p)) queue.push(p);
        }
    }
  }
  check(models.length, 'No se encontraron modelos FMDL en los archivos seleccionados');
  return models;
}
