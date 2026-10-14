/** Emscripten-generated glue is built separately; its dynamic exports wrap C ABI. */
declare module '*geometry.js' {
  const create: (options?: any) => Promise<any>;
  export default create;
}
declare module '*audio-core.js' {
  const create: (options?: any) => Promise<any>;
  export default create;
}
declare const currentTime: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new (...args: any[]) => AudioWorkletProcessor,
): void;
