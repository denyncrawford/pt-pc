import type { Preface, PrefaceFrame } from '../sequences/preface';
import { control, getPrefaceCanvas } from './renderer-elements';

export function createPrefaceOverlay(preface: Preface) {
  const images = new Map<string, OffscreenCanvas>();
  for (const [path, texture] of preface.textures) {
    const image = new OffscreenCanvas(texture.width, texture.height);
    const context = image.getContext('2d');
    if (!context) throw Error('No se pudo preparar la apertura');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(texture.rgba), texture.width, texture.height),
      0,
      0,
    );
    images.set(path, image);
  }
  function draw(frame: PrefaceFrame) {
    const canvas = getPrefaceCanvas();
    control('preface').hidden = frame.finished;
    control('preface-caption').textContent = frame.finished ? '' : frame.caption;
    if (!canvas || frame.finished) return;
    if (canvas.width !== 1280 || canvas.height !== 720) {
      canvas.width = 1280;
      canvas.height = 720;
    }
    const context = canvas.getContext('2d');
    if (!context) throw Error('No se pudo mostrar la apertura');
    context.globalAlpha = 1;
    context.fillStyle = 'black';
    context.fillRect(0, 0, 1280, 720);
    for (const picture of frame.pictures) {
      const image = images.get(picture.texture);
      if (!image) throw Error('Imagen de apertura ausente');
      context.globalAlpha = Math.max(0, Math.min(1, picture.opacity));
      context.drawImage(image, picture.x, picture.y, picture.width, picture.height);
    }
    context.globalAlpha = 1;
  }
  return {
    update(dt: number) {
      const frame = preface.update(dt);
      draw(frame);
      return frame.finished;
    },
    destroy() {
      preface.destroy();
      images.clear();
      control('preface').hidden = true;
      control('preface-caption').textContent = '';
    },
  };
}
