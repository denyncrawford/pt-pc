/** Browser save data contains progress only, never resources from the user's PKG. */
export const savedFloors = ['f000', 'f010', 'f005', 'f020', 'f030', 'f040', 'f060'] as const;
export type SavedFloor = (typeof savedFloors)[number];
export interface Checkpoint {
  floor: SavedFloor;
  photoWord: number;
}
export interface SavedGame extends Checkpoint {
  version: 1;
  updatedAt: number;
}
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = 'pt-web-progress';
const BACKUP = KEY + '-backup';
export function isSavedFloor(value: unknown): value is SavedFloor {
  return typeof value === 'string' && savedFloors.some((floor) => floor === value);
}
export function validateCheckpoint(value: unknown): Checkpoint {
  if (
    !value ||
    typeof value !== 'object' ||
    !('floor' in value) ||
    !isSavedFloor(value.floor) ||
    !('photoWord' in value) ||
    typeof value.photoWord !== 'number' ||
    !Number.isInteger(value.photoWord) ||
    value.photoWord < 0 ||
    value.photoWord > 0x1ff
  )
    throw Error('La partida guardada no es compatible. No se ha borrado tu progreso.');
  return { floor: value.floor, photoWord: value.photoWord };
}
function decode(raw: string): SavedGame {
  const value: unknown = JSON.parse(raw);
  const checkpoint = validateCheckpoint(value);
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('updatedAt' in value) ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt)
  )
    throw Error('La versión del guardado no es compatible. No se ha borrado tu progreso.');
  return { ...checkpoint, version: 1, updatedAt: value.updatedAt };
}
/** Atomic localStorage replacement plus previous valid slot. Tokenized host URLs never enter the key. */
export class SaveGameStore {
  constructor(
    private readonly storage: SaveStorage,
    private readonly now = Date.now,
  ) {}
  read(): SavedGame | null {
    const primary = this.storage.getItem(KEY),
      backup = this.storage.getItem(BACKUP);
    if (primary === null && backup === null) return null;
    for (const raw of [primary, backup]) {
      if (raw === null) continue;
      try {
        return decode(raw);
      } catch {}
    }
    throw Error(
      'No se pudo leer la partida guardada. Se conserva para recuperarla; no se iniciará otra automáticamente.',
    );
  }
  write(checkpoint: Checkpoint): SavedGame {
    const next = { ...validateCheckpoint(checkpoint), version: 1 as const, updatedAt: this.now() };
    const previous = this.read();
    if (previous && previous.floor === next.floor && previous.photoWord === next.photoWord)
      return previous;
    try {
      if (previous) this.storage.setItem(BACKUP, JSON.stringify(previous));
      this.storage.setItem(KEY, JSON.stringify(next));
    } catch {
      throw Error(
        'No se pudo guardar el progreso en este navegador. El guardado anterior se conserva.',
      );
    }
    return next;
  }
  /** Only the explicit, confirmed Restart action may call this. Replace both slots. */
  reset(): void {
    const fresh = JSON.stringify({
      version: 1,
      floor: 'f000',
      photoWord: 1,
      updatedAt: this.now(),
    });
    // Primary first: a backup-write failure must never resurrect the previous run.
    this.storage.setItem(KEY, fresh);
    this.storage.setItem(BACKUP, fresh);
  }
}
