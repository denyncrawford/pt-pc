import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintRuntime } from '../scripts/runtime-fingerprint';

const encode = (text: string) => new TextEncoder().encode(text);
test('versions entry points, dynamic imports, workers, CSS and WASM as one graph', () => {
  const files = new Map([
    ['index.html', encode('<link href="./app.css"><script src="./launcher.js"></script>')],
    [
      'launcher.js',
      encode('import("./app.js"); new Worker(new URL("./worker.js", import.meta.url));'),
    ],
    ['app.js', encode('import create from "./geometry.js";')],
    ['worker.js', encode('fetch(new URL("./geometry.wasm", import.meta.url));')],
    ['geometry.js', encode('const file = "geometry.wasm";')],
    ['geometry.wasm', new Uint8Array([0, 97, 115, 109])],
    ['app.css', encode('body {color:white}')],
  ]);
  const first = fingerprintRuntime(files);
  const read = (name: string) =>
    new TextDecoder().decode(first.files.get(first.renamed.get(name) ?? name));
  for (const name of [
    'launcher.js',
    'app.js',
    'worker.js',
    'geometry.js',
    'geometry.wasm',
    'app.css',
  ]) {
    assert.ok(first.files.has(first.renamed.get(name)!));
    assert.ok(!first.files.has(name));
  }
  assert.ok(read('index.html').includes(`./${first.renamed.get('launcher.js')}`));
  assert.ok(read('index.html').includes(`./${first.renamed.get('app.css')}`));
  assert.ok(read('launcher.js').includes(`./${first.renamed.get('app.js')}`));
  assert.ok(read('launcher.js').includes(`./${first.renamed.get('worker.js')}`));
  assert.ok(read('app.js').includes(`./${first.renamed.get('geometry.js')}`));
  assert.ok(read('worker.js').includes(`./${first.renamed.get('geometry.wasm')}`));
  assert.ok(read('geometry.js').includes(first.renamed.get('geometry.wasm')!));
  assert.deepEqual(
    first.files.get(first.renamed.get('geometry.wasm')!),
    files.get('geometry.wasm'),
  );
  assert.equal(first.revision, fingerprintRuntime(new Map([...files].reverse())).revision);
  files.set('geometry.wasm', new Uint8Array([0, 97, 115, 109, 1]));
  const second = fingerprintRuntime(files);
  assert.notEqual(first.revision, second.revision);
  assert.notEqual(first.renamed.get('launcher.js'), second.renamed.get('launcher.js'));
});
