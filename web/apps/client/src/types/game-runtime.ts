import type { Checkpoint } from '../modules/gameplay/save-game';
import type { GameOptions } from '../modules/settings/options';
import type { LibrarySource } from '../modules/library/local-library';

export interface MenuOptions extends GameOptions {
  brightnessIndex: number;
}
export interface OriginalMenu {
  open(options: MenuOptions): void;
  setOptions(options: MenuOptions): void;
  close(): void;
  fadeOut(): Promise<void>;
  destroy(): void;
}
/** The UI contract; renderer implementation stays outside React's lifecycle. */
export interface GameRuntime {
  configureGame(options: Partial<GameOptions>): void;
  setMenuPaused(paused: boolean): void;
  unloadWalk(): Promise<void>;
  loadWalk(
    archive: LibrarySource,
    textures: LibrarySource,
    progress: (done: number, total: number) => void,
    scene: 'start' | 'hallway',
    checkpoint?: Checkpoint,
    onCheckpoint?: (checkpoint: Checkpoint) => void,
  ): Promise<boolean>;
  createOriginalMenu(
    canvas: HTMLCanvasElement,
    archive: LibrarySource,
    textures: LibrarySource,
    onAction: (action: string, value: unknown) => void,
  ): Promise<OriginalMenu>;
}
export type RuntimeLoader = () => Promise<GameRuntime>;
