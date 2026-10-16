import type { ExtractRequest, ExtractResponse } from './pkg-protocol';
export async function importPackage(
  file: File,
  progress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<{ persisted: boolean }> {
  signal.throwIfAborted();
  const persisted = await navigator.storage.persist().catch(() => false);
  signal.throwIfAborted();
  const workerPath = './pkg-worker.js';
  const worker = new Worker(new URL(workerPath, import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const send = (data: ExtractRequest) => worker.postMessage(data);
    const cancel = () => send({ type: 'cancel' });
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<ExtractResponse>) => {
      const response = event.data;
      if (response.type === 'progress') progress(response.done, response.total);
      else if (response.type === 'complete') {
        finish();
        resolve({ persisted });
      } else {
        finish();
        reject(new Error(response.message));
      }
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error('The local extractor stopped unexpectedly. Your previous library is unchanged.'),
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    send({ type: 'extract', file });
  });
}
