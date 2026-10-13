/** DOM handles owned by the imperative WebGPU renderer, never by React. */
interface Elements {
  "audio-meter": HTMLElement;
  "audio-status": HTMLElement;
  "canvas": HTMLCanvasElement;
  "demo": HTMLButtonElement;
  "enter": HTMLButtonElement;
  "error": HTMLElement;
  "files": HTMLInputElement;
  "indirect": HTMLInputElement;
  "inspect-mirror": HTMLButtonElement;
  "menu-error": HTMLElement;
  "mirrors": HTMLInputElement;
  "models": HTMLSelectElement;
  "opening-fade": HTMLElement;
  "reflections": HTMLInputElement;
  "reset": HTMLButtonElement;
  "shadows": HTMLInputElement;
  "stage-loading": HTMLButtonElement;
  "status": HTMLElement;
  "subtitle-language": HTMLSelectElement;
  "subtitles": HTMLElement;
  "walk-debug": HTMLElement;
}
export function element<K extends keyof Elements>(id: K): Elements[K];
export function element(id: string): HTMLElement;
export function element(id: string): HTMLElement {
 const node=document.getElementById(id);
 if(!node)throw new Error(`Missing UI element: ${id}`);
 return node;
}
