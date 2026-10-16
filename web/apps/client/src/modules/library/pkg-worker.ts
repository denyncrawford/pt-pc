import { blockReader, openPackage } from '@pt-web/pkg-extractor';
import { importLocalLibrary } from './local-library';
import type { ExtractRequest, ExtractResponse } from './pkg-protocol';
// FileReaderSync is only exposed in dedicated workers; the app uses DOM typings.
declare const FileReaderSync: { new (): { readAsArrayBuffer(blob: Blob): ArrayBuffer } };
const send = (message: ExtractResponse) => globalThis.postMessage(message);
let controller: AbortController | undefined;
globalThis.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  if (event.data.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (controller) return;
  controller = new AbortController();
  try {
    const file = event.data.file;
    const sync = new FileReaderSync();
    const block = 1024 * 1024;
    const reader = blockReader(
      file.size,
      block,
      (index) =>
        new Uint8Array(sync.readAsArrayBuffer(file.slice(index * block, (index + 1) * block))),
      4,
    );
    const sources = openPackage(reader);
    await importLocalLibrary(
      sources,
      (done, total) => send({ type: 'progress', done, total }),
      controller.signal,
    );
    send({ type: 'complete' });
  } catch (error) {
    send({
      type: 'error',
      message: controller.signal.aborted
        ? 'Import cancelled. Your previous library is unchanged.'
        : error instanceof Error
          ? error.message
          : 'Could not extract this package.',
    });
  } finally {
    controller = undefined;
  }
};
