// Native decoder instances with a shared, pauseable scene clock.
import { withEntry } from '../gameplay/runtime';
export const SEQUENCE_FPS = 60000 / 1001;
export class SequenceClock {
  declare seconds: any;
  declare paused: any;

  constructor() {
    this.seconds = 0;
    this.paused = false;
  }
  advance(dt: any) {
    if (!Number.isFinite(dt) || dt < 0) throw Error('Invalid sequence delta');
    if (!this.paused) this.seconds += dt;
    return this.seconds;
  }
}
export class SequencePlayer {
  declare lights: Map<string, { name: string; data: Float32Array; dynamic: boolean }>;
  declare models: any;
  declare origin: any;
  declare w: any;
  declare name: any;
  declare clock: any;
  declare handle: any;
  declare length: any;
  declare actors: any;
  declare events: any;
  declare state: any;
  declare frame: any;
  declare cursor: any;
  declare started: any;

  constructor(w: any, bytes: any, name: any, clock: any) {
    this.w = w;
    this.name = name;
    this.clock = clock;
    this.handle = withEntry(w, bytes, name, (p: any, n: any) => w._sequence_create(p, n));
    if (!this.handle) throw Error(name + ': ' + w.UTF8ToString(w._sequence_error()));
    try {
      this.use(() => {
        this.length = w._sequence_length();
        this.actors = Array.from({ length: w._sequence_actor_count() }, (_: any, i: any) => ({
          index: i,
          kind: w._sequence_actor_kind(i),
          name: w.UTF8ToString(w._sequence_actor_name(i)),
        }));
        this.events = Array.from({ length: w._sequence_event_count() }, (_: any, i: any) => ({
          index: i,
          frame: w._sequence_event_start(i),
          type: w._sequence_event_type(i),
          functor: w._sequence_event_functor(i),
          soundId: w._sequence_event_sound(i) >>> 0,
        }));
      });
    } catch (e) {
      this.destroy();
      throw e;
    }
    this.state = 'ready';
    this.frame = 0;
    this.cursor = 0;
  }
  use(fn: any) {
    const w = this.w,
      old = w._sequence_selected();
    if (!this.handle || !w._sequence_select(this.handle))
      throw Error('Released sequence: ' + this.name);
    try {
      return fn();
    } finally {
      w._sequence_select(old);
    }
  }
  play() {
    if (this.state === 'disposed') throw Error('Released sequence');
    this.started = this.clock.seconds;
    this.frame = 0;
    this.cursor = 0;
    this.state = 'playing';
  }
  update(dispatch: any) {
    if (this.state !== 'playing') return;
    const frame = Math.min(this.length, (this.clock.seconds - this.started) * SEQUENCE_FPS);
    // Keep the failed event pending. A required handler cannot be silently skipped.
    while (this.cursor < this.events.length && this.events[this.cursor].frame <= frame) {
      this.use(() => dispatch(this.events[this.cursor], this));
      this.cursor++;
    }
    this.frame = frame;
    if (frame >= this.length) this.state = 'finished';
  }
  sample(actor: any, unit: any = 0) {
    return this.use(() => {
      const p = this.w._sequence_sample(actor, unit, this.frame);
      return p ? this.w.HEAPF32.slice(p / 4, p / 4 + 8) : null;
    });
  }
  stop() {
    if (this.state !== 'disposed') this.state = 'stopped';
  }
  destroy() {
    if (this.handle) this.w._sequence_release(this.handle);
    this.handle = 0;
    this.state = 'disposed';
  }
}

// DemoSystem::CameraCurve; t and curve parameters have the native clamps.
export function cameraCurve(type: any, t: any, rate: any = 1, center: any = 0.5) {
  t = Math.max(0, Math.min(1, t));
  if (type === 0) return 1;
  if (type === 1) return t;
  let c = t;
  if (type === 2) c = Math.sin(t * Math.PI * 0.5);
  else if (type === 3) {
    const cc = Math.max(0.01, Math.min(0.99, center)),
      a = (0.5 - 3 * cc * cc + 2 * cc ** 3) / (cc * cc * (cc - 1) ** 2),
      b = -2 - 2 * a,
      d = 3 + a;
    c = Math.max(0, Math.min(1, a * t ** 4 + b * t ** 3 + d * t * t));
  } else return t;
  const r = Math.max(0, Math.min(1, rate));
  return c * r + (1 - r) * t;
}
function cameraQuaternion(view: any) {
  if (!view.basis) {
    const y = view.yaw / 2,
      p = view.pitch / 2;
    return [
      Math.cos(y) * Math.sin(p),
      -Math.sin(y) * Math.cos(p),
      Math.sin(y) * Math.sin(p),
      Math.cos(y) * Math.cos(p),
    ];
  }
  const r = view.basis.right,
    u = view.basis.up,
    b = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]],
    m = [r, u, b],
    q = [0, 0, 0, 0],
    trace = r[0] + u[1] + b[2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q[3] = s / 4;
    q[0] = (u[2] - b[1]) / s;
    q[1] = (b[0] - r[2]) / s;
    q[2] = (r[1] - u[0]) / s;
  } else {
    let i = 0;
    if (u[1] > r[0]) i = 1;
    if (b[2] > m[i][i]) i = 2;
    const j = (i + 1) % 3,
      k = (i + 2) % 3,
      s = Math.sqrt(1 + m[i][i] - m[j][j] - m[k][k]) * 2;
    q[i] = s / 4;
    q[j] = (m[i][j] + m[j][i]) / s;
    q[k] = (m[i][k] + m[k][i]) / s;
    q[3] = (m[j][k] - m[k][j]) / s;
  }
  const n = Math.hypot(...q);
  return q.map((v: any) => v / n);
}
export class NativeCameraBlend {
  declare metadata: any;
  declare from: any;
  declare start: any;
  declare offset: any;

  constructor(metadata: any, from: any) {
    this.metadata = metadata;
    this.from = from
      ? { ...from, camera: [...from.camera], rotation: cameraQuaternion(from) }
      : null;
    this.start = null;
  }
  apply(view: any, frame: any) {
    const m = this.metadata;
    if (!this.from || !m?.cameraInterpType || m.cameraInterpFrame <= 0) return view;
    if (frame <= 0) return { ...view, ...this.from };
    if (this.start === null) {
      this.start = Math.trunc(frame);
      this.offset = view.camera.map((v: any, i: any) => v - this.from.camera[i]);
    }
    const t = (frame - this.start) / Math.max(1, m.cameraInterpFrame);
    if (t >= 1) return view;
    const weight = cameraCurve(
        m.cameraInterpType,
        t,
        m.cameraInterpCurveRate,
        m.cameraInterpScurveCenter,
      ),
      a = this.from.rotation;
    let b = cameraQuaternion(view),
      dot = a.reduce((s: any, v: any, i: any) => s + v * b[i], 0);
    if (dot < 0) {
      b = b.map((v: any) => -v);
      dot = -dot;
    }
    dot = Math.min(1, dot);
    let q;
    if (dot > 0.9995) q = a.map((v: any, i: any) => v + (b[i] - v) * weight);
    else {
      const theta = Math.acos(dot),
        d = Math.sin(theta);
      q = a.map(
        (v: any, i: any) =>
          (v * Math.sin((1 - weight) * theta) + b[i] * Math.sin(weight * theta)) / d,
      );
    }
    const norm = Math.hypot(...q);
    const [x, y, z, w] = q.map((v: any) => v / norm),
      right = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      up = [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      forward = [-2 * (x * z + y * w), -2 * (y * z - x * w), -(1 - 2 * (x * x + y * y))];
    const focal = 6.75 / Math.tan(this.from.fov / 2),
      target = 6.75 / Math.tan(view.fov / 2);
    return {
      ...view,
      camera: view.camera.map((v: any, i: any) => v - (1 - weight) * this.offset[i]),
      yaw: Math.atan2(forward[0], -forward[2]),
      pitch: Math.asin(Math.max(-1, Math.min(1, forward[1]))),
      basis: { right, up },
      fov: 2 * Math.atan(6.75 / (focal + (target - focal) * weight)),
    };
  }
}
