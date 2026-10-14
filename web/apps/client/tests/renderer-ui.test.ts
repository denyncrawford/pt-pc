import { expect, test } from 'bun:test';
import { control, rendererUi } from '../src/modules/renderer/renderer-elements';

test('engine UI publishes a batched snapshot and stops notifying unsubscribed views', async () => {
  const entry = control('test-ui'),
    before = rendererUi.snapshot();
  let notifications = 0;
  const unsubscribe = rendererUi.subscribe(() => notifications++);
  entry.textContent = 'Loading';
  entry.style.opacity = 0.5;
  await Promise.resolve();
  expect(notifications).toBe(1);
  expect(rendererUi.snapshot()).toBeGreaterThan(before);
  entry.textContent = 'Loading';
  await Promise.resolve();
  expect(notifications).toBe(1);
  unsubscribe();
  entry.textContent = 'Ready';
  await Promise.resolve();
  expect(notifications).toBe(1);
});

test('React controls deliver current values to engine callbacks', () => {
  const entry = control('test-graphics');
  let enabled = true,
    clicks = 0;
  entry.onchange = () => {
    enabled = entry.checked;
  };
  entry.onclick = () => {
    clicks++;
  };
  entry.checked = false;
  entry.onchange();
  entry.click();
  expect(enabled).toBe(false);
  expect(clicks).toBe(1);
});
