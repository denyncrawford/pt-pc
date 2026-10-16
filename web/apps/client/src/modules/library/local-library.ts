export const libraryFiles = ['chunk1.psarc', 'texture.qar', 'pathid_list_ps4.bin'] as const;
type LibraryFile = (typeof libraryFiles)[number];
interface Manifest {
  version: 1;
  id: string;
  sizes: Record<LibraryFile, number>;
}
export interface LibrarySource {
  name: string;
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
export interface LocalLibrary {
  archive: File;
  textures: File;
}
const rootName = 'pt-local-library-v1';
const blockSize = 2 * 1024 * 1024;

async function root() {
  if (!navigator.storage?.getDirectory || !navigator.locks)
    throw new Error('Local storage is unavailable. Use a current browser over HTTPS or localhost.');
  return (await navigator.storage.getDirectory()).getDirectoryHandle(rootName, { create: true });
}
function missing(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'NotFoundError';
}
async function readManifest(directory: FileSystemDirectoryHandle): Promise<Manifest | null> {
  let file: File;
  try {
    file = await (await directory.getFileHandle('active.json')).getFile();
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
  const data: unknown = JSON.parse(await file.text());
  if (
    typeof data !== 'object' ||
    data === null ||
    !('version' in data) ||
    data.version !== 1 ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(data.id) ||
    !('sizes' in data) ||
    typeof data.sizes !== 'object' ||
    data.sizes === null
  )
    throw new Error('Local library metadata is invalid. Import your files again.');
  const sizes = data.sizes;
  for (const name of libraryFiles) {
    if (
      !(name in sizes) ||
      !Number.isSafeInteger(Reflect.get(sizes, name)) ||
      Reflect.get(sizes, name) <= 0
    )
      throw new Error('Local library metadata is invalid.');
  }
  return data as Manifest;
}

export async function openLocalLibrary(): Promise<LocalLibrary | null> {
  const directory = await root();
  const manifest = await readManifest(directory);
  if (!manifest) return null;
  const generation = await directory.getDirectoryHandle(manifest.id);
  const files = await Promise.all(
    libraryFiles.map(async (name) => {
      const file = await (await generation.getFileHandle(name)).getFile();
      if (file.size !== manifest.sizes[name])
        throw new Error('Local library is incomplete. Import your files again.');
      return file;
    }),
  );
  return { archive: files[0]!, textures: files[1]! };
}

async function validate(
  files: readonly LibrarySource[],
): Promise<Record<LibraryFile, LibrarySource>> {
  if (files.length !== libraryFiles.length)
    throw new Error('Select all three extracted game files together.');
  const selected = {} as Record<LibraryFile, LibrarySource>;
  for (const name of libraryFiles) {
    const matches = files.filter((file) => file.name === name);
    const file = matches[0];
    if (matches.length !== 1 || !file || file.size <= 0 || file.size > 4 * 1024 ** 3)
      throw new Error('Missing or invalid file: ' + name);
    selected[name] = file;
  }
  const magic = new TextDecoder().decode(await selected['chunk1.psarc'].slice(0, 4).arrayBuffer());
  const footer = new Uint8Array(await selected['texture.qar'].slice(-0x24).arrayBuffer());
  if (magic !== 'PSAR' || footer.length !== 0x24 || footer[0x16] !== 0x61 || footer[0x17] !== 0x71)
    throw new Error('These files are not compatible game archives.');
  const paths = selected['pathid_list_ps4.bin'];
  for (let offset = 0; offset < paths.size; offset += blockSize) {
    const bytes = await paths.slice(Math.max(0, offset - 4), offset + blockSize).arrayBuffer();
    if (new TextDecoder().decode(bytes).includes('pt14_')) return selected;
  }
  throw new Error('The path list does not identify P.T. game data.');
}

export async function importLocalLibrary(
  files: readonly LibrarySource[],
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ persisted: boolean }> {
  const selected = await validate(files);
  const directory = await root();
  return navigator.locks.request(
    rootName,
    { mode: 'exclusive', ...(signal ? { signal } : {}) },
    async () => {
      signal?.throwIfAborted();
      const total = files.reduce((sum, file) => sum + file.size, 0);
      const estimate = await navigator.storage.estimate();
      if (
        estimate.quota !== undefined &&
        total + (estimate.usage ?? 0) + 16 * 1024 ** 2 > estimate.quota
      )
        throw new Error('Not enough browser storage. Free space before importing.');
      const persisted = (await navigator.storage.persist?.().catch(() => false)) ?? false;
      const id = crypto.randomUUID();
      const generation = await directory.getDirectoryHandle(id, { create: true });
      let committed = false;
      try {
        let done = 0;
        const sizes = {} as Record<LibraryFile, number>;
        for (const name of libraryFiles) {
          const file = selected[name];
          const output = await (
            await generation.getFileHandle(name, { create: true })
          ).createWritable();
          try {
            for (let offset = 0; offset < file.size; offset += blockSize) {
              signal?.throwIfAborted();
              const bytes = await file.slice(offset, offset + blockSize).arrayBuffer();
              await output.write(bytes);
              done += bytes.byteLength;
              progress(done, total);
            }
            await output.close();
          } catch (cause) {
            await output.abort().catch(() => {});
            throw cause;
          }
          sizes[name] = file.size;
        }
        signal?.throwIfAborted();
        const pointer = await (
          await directory.getFileHandle('active.json', { create: true })
        ).createWritable();
        try {
          await pointer.write(JSON.stringify({ version: 1, id, sizes } satisfies Manifest));
          await pointer.close();
        } catch (cause) {
          await pointer.abort().catch(() => {});
          throw cause;
        }
        committed = true;
        return { persisted };
      } finally {
        // Keep previous generations: another tab may still be reading them.
        // A crash can leave an unreferenced generation; cleanup is future work.
        if (!committed) await directory.removeEntry(id, { recursive: true });
      }
    },
  );
}
