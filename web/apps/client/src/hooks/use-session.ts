import { SaveGameStore, type Checkpoint } from '../modules/gameplay/save-game';
import { useEffect, useRef, useState } from 'react';
import { remoteArchive } from '../services/remote-archive';
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
  function upload(file: File) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', new URL('api/pkg', location.href));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          setWizard({
            kind: 'loading',
            title: 'Cargando tu copia',
            done: e.loaded,
            total: e.total,
          });
      };
      xhr.upload.onload = () => setWizard({ kind: 'loading', title: 'Preparando tu copia' });
      xhr.onerror = () => reject(new Error('Se perdió la conexión. Vuelve a intentarlo.'));
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error('No se pudo preparar esta copia. Vuelve a intentarlo.'));
      xhr.send(file);
    });
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
  async function start(file?: File) {
    if (busy.current) return;
    busy.current = true;
    try {
      const checkpoint = saveStore().read() ?? undefined;
      if (file) {
        setWizard({ kind: 'loading', title: 'Cargando tu copia' });
        await upload(file);
      }
      setWizard({ kind: 'loading', title: 'Cargando partida', done: 0, total: 7 });
      const game = await loadRuntime();
      const archive = await remoteArchive(location.href),
        textures = await remoteArchive(location.href, 'texture.qar');
      const loaded = await game.loadWalk(
        archive,
        textures,
        (done: number, total: number) =>
          setWizard({ kind: 'loading', title: 'Cargando partida', done, total }),
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
      if (!loaded) throw new Error('No se pudo iniciar la partida. Vuelve a intentarlo.');
      native.current?.destroy();
      if (!nativeCanvas.current) throw new Error('No se pudo preparar el menú');
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
    fetch(new URL('api/status', location.href))
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data: unknown = await response.json();
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
      .catch(() => {
        if (active && !busy.current)
          setWizard({
            kind: 'choose',
            ready: false,
            error: 'No se pudo conectar. Recarga la página.',
          });
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.title = playing ? 'P.T. · Web' : 'P.T. · Configuración';
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
        'Este navegador no pudo capturar el ratón. Abre esta dirección en Chrome o Edge.';
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
      control('menu-error').textContent = 'Pantalla completa no disponible: ' + errorMessage(e);
    }
  }
  return {
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
