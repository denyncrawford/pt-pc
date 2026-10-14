import type { GameOptions } from '../modules/settings/options';
import type { RangeArchive } from '../services/remote-archive';

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
    archive: RangeArchive,
    textures: RangeArchive,
    progress: (done: number, total: number) => void,
    scene: 'start' | 'hallway',
  ): Promise<boolean>;
  createOriginalMenu(
    canvas: HTMLCanvasElement,
    archive: RangeArchive,
    textures: RangeArchive,
    onAction: (action: string, value: unknown) => void,
  ): Promise<OriginalMenu>;
}
export type RuntimeLoader = () => Promise<GameRuntime>;
