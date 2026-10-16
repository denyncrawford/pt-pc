import { importPackage } from '../modules/library/pkg-import';
import { openLocalLibrary, importLocalLibrary } from '../modules/library/local-library';
import { SaveGameStore, type Checkpoint } from '../modules/gameplay/save-game';
import { useEffect, useRef, useState } from 'react';
import { control } from '../modules/renderer/renderer-elements';
import {
  brightnessIndex,
  brightnessLevels,
  errorMessage,
  parseOptions,
  type GameOptions,
} from '../modules/settings/options';
import type { GameRuntime, OriginalMenu, RuntimeLoader } from '../types/game-runtime';
export type WizardState =
  | { kind: 'choose'; ready: boolean; error?: string }
  | { kind: 'loading'; title: string; done?: number; total?: number }
  | { kind: 'playing' };
export function useSession(loadEngine: RuntimeLoader) {
  const [storageNotice, setStorageNotice] = useState('');
  const [wizard, setWizard] = useState<WizardState>({ kind: 'choose', ready: false });
  const [options, setOptions] = useState<GameOptions>(() => {
    try {
      return parseOptions(JSON.parse(localStorage.getItem('pt-web-options') ?? 'null'));
    } catch {
      return parseOptions(null);
    }
  });
  const [page, setPage] = useState<'closed' | 'native' | 'web'>('closed');
  const [confirm, setConfirm] = useState(false);
  const [started, setStarted] = useState(false);
  const [capture, setCapture] = useState(false);
  const runtime = useRef<GameRuntime | null>(null),
    native = useRef<OriginalMenu | null>(null),
    busy = useRef(false);
  const nativeCanvas = useRef<HTMLCanvasElement>(null),
    viewer = useRef<HTMLElement>(null);
  const currentOptions = useRef(options);
  currentOptions.current = options;
  const playing = wizard.kind === 'playing';
  const development = new URL(location.href).searchParams.has('dev');
  function configure(next: GameOptions) {
    currentOptions.current = next;
    setOptions(next);
    runtime.current?.configureGame(next);
    try {
      localStorage.setItem('pt-web-options', JSON.stringify(next));
    } catch {}
  }
  function nativeOptions() {
    return {
      ...currentOptions.current,
      brightnessIndex: brightnessIndex(currentOptions.current.brightness),
    };
  }
  async function loadRuntime() {
    if (!runtime.current) {
      const module = await loadEngine();
      runtime.current = module;
      module.configureGame(currentOptions.current);
    }
    return runtime.current;
  }
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingSave = useRef<Checkpoint | null>(null);
  const saves = useRef<SaveGameStore | null>(null);
  function saveStore() {
    return (saves.current ??= new SaveGameStore(localStorage));
  }
  function saveProgress(checkpoint: Checkpoint) {
    pendingSave.current = checkpoint;
    try {
      saveStore().write(checkpoint);
      pendingSave.current = null;
      setSaveError(null);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  }
  async function start() {
    if (busy.current) return;
    busy.current = true;
    try {
      const checkpoint = saveStore().read() ?? undefined;
      setWizard({ kind: 'loading', title: 'Loading game', done: 0, total: 7 });
      const game = await loadRuntime();
      const local = await openLocalLibrary();
      if (!local) throw new Error('Import your copy first.');
      const { archive, textures } = local;
      const loaded = await game.loadWalk(
        archive,
        textures,
        (done: number, total: number) =>
          setWizard({ kind: 'loading', title: 'Loading game', done, total }),
        checkpoint
          ? checkpoint.floor === 'f000'
            ? 'start'
            : 'hallway'
          : new URL(location.href).searchParams.get('scene') === 'hallway'
            ? 'hallway'
            : 'start',
        checkpoint,
        saveProgress,
      );
      if (!loaded) throw new Error('Could not start the game. Please try again.');
      native.current?.destroy();
      if (!nativeCanvas.current) throw new Error('Could not prepare the menu');
      native.current = await game.createOriginalMenu(
        nativeCanvas.current,
        archive,
        textures,
        nativeAction,
      );
      game.setMenuPaused(true);
      setStarted(false);
      setWizard({ kind: 'playing' });
    } catch (e) {
      native.current?.destroy();
      native.current = null;
      await runtime.current?.unloadWalk();
      setWizard({ kind: 'choose', ready: true, error: errorMessage(e) });
    } finally {
      busy.current = false;
    }
  }
  async function library() {
    native.current?.destroy();
    native.current = null;
    setPage('closed');
    setCapture(false);
    setStarted(false);
    await runtime.current?.unloadWalk();
    setWizard({ kind: 'choose', ready: true });
  }
  function openMenu() {
    if (!playing) return;
    setCapture(false);
    runtime.current?.setMenuPaused(true);
    setPage('native');
  }
  async function resume() {
    await native.current?.fadeOut();
    native.current?.close();
    setPage('closed');
    setCapture(false);
    runtime.current?.setMenuPaused(false);
    control('enter').click();
  }
  function begin() {
    setStarted(true);
    runtime.current?.setMenuPaused(false);
    control('enter').click();
  }
  function nativeAction(action: string, value: unknown) {
    if (action === 'web') {
      setPage('web');
      return;
    }
    if (action === 'back') {
      void resume();
      return;
    }
    if (action === 'exit') {
      void library();
      return;
    }
    const next = { ...currentOptions.current };
    if (
      action === 'brightness' &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      brightnessLevels[value] !== undefined
    )
      next.brightness = brightnessLevels[value]!;
    else if (
      action === 'language' &&
      (typeof value === 'string' || value === null || value === false)
    ) {
      next.subtitles = !!value;
      if (typeof value === 'string' && value)
        next.language = value[0]!.toUpperCase() + value.slice(1);
    } else if ((action === 'invertX' || action === 'invertY') && typeof value === 'boolean')
      next[action] = value;
    configure(next);
    native.current?.setOptions({ ...next, brightnessIndex: brightnessIndex(next.brightness) });
  }
  useEffect(() => {
    let active = true;
    openLocalLibrary()
      .then((local) => ({ state: local ? 'ready' : 'empty' }))
      .then((data: unknown) => {
        if (active && !busy.current)
          setWizard({
            kind: 'choose',
            ready:
              typeof data === 'object' &&
              data !== null &&
              'state' in data &&
              data.state === 'ready',
          });
      })
      .catch((cause: unknown) => {
        if (active && !busy.current)
          setWizard({
            kind: 'choose',
            ready: false,
            error: errorMessage(cause),
          });
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.title = playing ? 'P.T. · Web' : 'P.T. · Setup';
  }, [playing]);
  useEffect(() => {
    if (page === 'native') native.current?.open(nativeOptions());
    else native.current?.close();
  }, [page]);
  useEffect(() => {
    const released = () => openMenu();
    const failed = () => {
      openMenu();
      control('menu-error').textContent =
        'This browser could not capture the mouse. Open this address in Chrome or Edge.';
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && page === 'closed' && !confirm && playing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openMenu();
      }
    };
    document.addEventListener('game-pointer-released', released);
    document.addEventListener('game-pointer-error', failed);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('game-pointer-released', released);
      document.removeEventListener('game-pointer-error', failed);
      window.removeEventListener('keydown', key, true);
    };
  }, [playing, page, confirm]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen();
    } catch (e) {
      control('menu-error').textContent = 'Fullscreen unavailable: ' + errorMessage(e);
    }
  }
  const importController = useRef<AbortController | null>(null);
  async function importFiles(files: readonly File[]) {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    importController.current = controller;
    const pkg = files.length === 1 && files[0]?.name.toLowerCase().endsWith('.pkg');
    setWizard({
      kind: 'loading',
      title: pkg ? 'Extracting your copy on this device' : 'Saving files on this device',
    });
    try {
      const progress = (done: number, total: number) =>
        setWizard({
          kind: 'loading',
          title: pkg ? 'Extracting your copy on this device' : 'Saving files on this device',
          done,
          total,
        });
      const result = pkg
        ? await importPackage(files[0]!, progress, controller.signal)
        : await importLocalLibrary(files, progress, controller.signal);
      setStorageNotice(
        result.persisted
          ? 'Saved on this device. Clearing site data removes this library.'
          : 'Saved on this device. The browser may reclaim this storage; keep your original files.',
      );
      setWizard({ kind: 'choose', ready: true });
    } catch (cause) {
      const ready = await openLocalLibrary()
        .then(Boolean)
        .catch(() => false);
      setWizard({ kind: 'choose', ready, error: errorMessage(cause) });
    } finally {
      importController.current = null;
      busy.current = false;
    }
  }
  return {
    cancelImport: () => importController.current?.abort(),
    storageNotice,
    importFiles,
    wizard,
    saveError,
    retrySave: () => {
      if (pendingSave.current) saveProgress(pendingSave.current);
    },
    options,
    page,
    confirm,
    started,
    capture,
    playing,
    development,
    nativeCanvas,
    viewer,
    start,
    library,
    configure,
    openMenu,
    resume,
    begin,
    setPage,
    setConfirm,
    restart: async () => {
      setConfirm(false);
      await library();
      try {
        saveStore().reset();
        await start();
      } catch (e) {
        setWizard({ kind: 'choose', ready: true, error: errorMessage(e) });
      }
    },
    settingsActions: {
      change: configure,
      fullscreen: () => void fullscreen(),
      restart: () => setConfirm(true),
      capture: () => {
        native.current?.close();
        setPage('closed');
        setCapture(true);
      },
    },
  };
}
