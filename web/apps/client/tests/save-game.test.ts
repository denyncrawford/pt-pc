import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveGameStore, type SaveStorage } from '../src/modules/gameplay/save-game';
class Storage implements SaveStorage {
  data = new Map<string, string>();
  fail = false;
  writes = 0;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw Error('quota');
    this.writes++;
    this.data.set(key, value);
  }
}
test('save survives reconstructed sessions and deduplicates unchanged checkpoints', () => {
  const storage = new Storage(),
    first = new SaveGameStore(storage, () => 100);
  assert.equal(first.read(), null);
  first.write({ floor: 'f030', photoWord: 0x10c });
  const writes = storage.writes;
  const resumed = new SaveGameStore(storage, () => 200);
  assert.deepEqual(resumed.read(), { version: 1, updatedAt: 100, floor: 'f030', photoWord: 0x10c });
  resumed.write({ floor: 'f030', photoWord: 0x10c });
  assert.equal(storage.writes, writes);
  resumed.write({ floor: 'f040', photoWord: 0x11c });
  assert.equal(new SaveGameStore(storage).read()?.floor, 'f040');
});
test('only explicit reset clears both progress slots, preserving unrelated options', () => {
  const storage = new Storage(),
    store = new SaveGameStore(storage);
  storage.setItem('pt-web-options', 'custom');
  store.write({ floor: 'f030', photoWord: 0x1fc });
  store.write({ floor: 'f040', photoWord: 0x1fc });
  store.reset();
  assert.equal(store.read()?.floor, 'f000');
  assert.equal(store.read()?.photoWord, 1);
  storage.data.delete('pt-web-progress');
  assert.equal(store.read()?.floor, 'f000');
  assert.equal(storage.getItem('pt-web-options'), 'custom');
});
test('damaged primary recovers previous valid slot; invalid saves are never replaced with a new run', () => {
  const storage = new Storage(),
    store = new SaveGameStore(storage);
  store.write({ floor: 'f030', photoWord: 0x10c });
  store.write({ floor: 'f040', photoWord: 0x11c });
  storage.data.set('pt-web-progress', 'broken');
  assert.equal(store.read()?.floor, 'f030');
  storage.data.set('pt-web-progress-backup', 'broken');
  assert.throws(() => store.read(), /No se pudo leer/);
  assert.throws(() => store.write({ floor: 'f000', photoWord: 1 }));
  assert.equal(storage.getItem('pt-web-progress'), 'broken');
});
test('failed write retains checkpoint; invalid puzzle words cannot be persisted', () => {
  const storage = new Storage(),
    store = new SaveGameStore(storage);
  store.write({ floor: 'f030', photoWord: 4 });
  storage.fail = true;
  assert.throws(() => store.write({ floor: 'f040', photoWord: 12 }), /No se pudo guardar/);
  assert.equal(store.read()?.floor, 'f030');
  storage.fail = false;
  for (const word of [-1, 512, NaN, 1.5])
    assert.throws(() => store.write({ floor: 'f030', photoWord: word }));
});
