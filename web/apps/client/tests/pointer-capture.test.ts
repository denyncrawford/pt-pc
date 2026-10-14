import { test, expect } from 'bun:test';
import { createPointerCapture } from '../src/modules/gameplay/runtime';
function setup(request: any = () => undefined) {
  const doc: EventTarget & { pointerLockElement?: any; focused?: boolean } = new EventTarget();
  Object.assign(doc, {
    pointerLockElement: null,
    hidden: false,
    focused: true,
    hasFocus() {
      return this.focused;
    },
    exitPointerLock() {
      this.pointerLockElement = null;
      this.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const canvas = {
    style: {} as Partial<CSSStyleDeclaration>,
    focus() {},
    requestPointerLock: request,
  };
  const events = [],
    deferred = [];
  const capture = createPointerCapture({
    canvas,
    doc,
    onCapture: () => events.push('capture'),
    onError: () => events.push('error'),
    onRelease: () => events.push('release'),
    defer: (fn: any) => deferred.push(fn),
  });
  const change = (value: any) => {
    doc.pointerLockElement = value ? canvas : null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  return {
    doc,
    canvas,
    events,
    capture,
    change,
    flush: () => deferred.splice(0).forEach((fn: any) => fn()),
  };
}
test('event-only lock hides cursor only after confirmed capture and release restores it', () => {
  const x = setup();
  x.capture.request();
  expect(x.canvas.style.cursor).not.toBe('none');
  x.change(true);
  expect(x.events).toEqual(['capture']);
  expect(x.canvas.style.cursor).toBe('none');
  x.change(false);
  x.flush();
  expect(x.events).toEqual(['capture', 'release']);
  expect(x.canvas.style.cursor).toBe('');
});
test('rejected lock reports error once without fake capture', async () => {
  const x = setup(() => Promise.reject(new Error('UnknownError')));
  x.capture.request();
  await Promise.resolve();
  x.doc.dispatchEvent(new Event('pointerlockerror'));
  expect(x.events).toEqual(['error']);
  expect(x.canvas.style.cursor).toBe('');
  expect(x.capture.locked()).toBe(false);
});
test('blur releases cursor without opening pause, recapture requires a new gesture', () => {
  const x = setup();
  x.capture.request();
  x.change(true);
  x.change(false);
  x.doc.focused = false;
  x.flush();
  expect(x.events).toEqual(['capture']);
  x.doc.focused = true;
  x.capture.request();
  x.change(true);
  expect(x.events).toEqual(['capture', 'capture']);
});
test('menu release and late cancelled acquisition do not resume the game', () => {
  const x = setup();
  x.capture.request();
  x.capture.release();
  x.change(true);
  x.flush();
  expect(x.events).toEqual([]);
  expect(x.capture.locked()).toBe(false);
  x.capture.request();
  x.change(true);
  x.capture.release();
  x.flush();
  expect(x.events).toEqual(['capture']);
});
test('missing API and synchronous errors leave cursor visible', () => {
  for (const request of [
    null,
    () => {
      throw new Error('Denied');
    },
  ]) {
    const x = setup(request);
    x.capture.request();
    expect(x.events).toEqual(['error']);
    expect(x.canvas.style.cursor).toBe('');
  }
});
