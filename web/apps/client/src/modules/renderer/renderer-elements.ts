/** Reactive UI bridge. The renderer writes view state; React owns every DOM node except canvas pixels. */
export interface Choice {
  value: string;
  label: string;
}
interface Control {
  textContent: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  files: readonly File[];
  choices: readonly Choice[];
  onclick: () => void;
  onchange: () => void;
  click(): void;
  style: { opacity: string | number };
}
const listeners = new Set<() => void>();
let revision = 0;
let queued = false;
function changed() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    revision++;
    for (const listener of listeners) listener();
  });
}
function observable<T extends object>(value: T): T {
  return new Proxy(value, {
    set(target, key, next) {
      if (Reflect.get(target, key) !== next) {
        Reflect.set(target, key, next);
        changed();
      }
      return true;
    },
  });
}
const controls = new Map<string, Control>();
let canvas: HTMLCanvasElement | null = null;
export function bindCanvas(value: HTMLCanvasElement | null) {
  canvas = value;
}
export const rendererUi = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => revision,
};
export function control(id: string): Control {
  let entry = controls.get(id);
  if (!entry) {
    entry = observable({
      textContent: '',
      value: '',
      checked: true,
      disabled: false,
      hidden: id === 'stage-loading',
      files: [],
      choices: [],
      onclick: () => {},
      onchange: () => {},
      click() {
        this.onclick();
      },
      style: observable({ opacity: 0 as string | number }),
    });
    controls.set(id, entry);
  }
  return entry;
}
export function element(id: 'canvas'): HTMLCanvasElement;
export function element(id: string): Control;
export function element(id: string): HTMLCanvasElement | Control {
  if (id !== 'canvas') return control(id);
  if (!canvas) throw new Error('Game canvas has not mounted');
  return canvas;
}
