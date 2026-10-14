export interface GameOptions {
  sensitivity: number;
  invertX: boolean;
  invertY: boolean;
  brightness: number;
  subtitles: boolean;
  language: string;
  volume: number;
  renderScale: number;
}
export const brightnessLevels = [
  0.48, 0.55, 0.6, 0.68, 0.76, 0.84, 0.92, 1, 1.05, 1.09, 1.13,
] as const;
export const defaultOptions: GameOptions = {
  sensitivity: 1,
  invertX: false,
  invertY: false,
  brightness: 1,
  subtitles: true,
  language: 'Spa',
  volume: 1,
  renderScale: 1,
};
export function parseOptions(value: unknown): GameOptions {
  const result = { ...defaultOptions };
  if (!value || typeof value !== 'object') return result;
  const data = value as Record<string, unknown>;
  for (const key of ['invertX', 'invertY', 'subtitles'] as const)
    if (typeof data[key] === 'boolean') result[key] = data[key];
  for (const key of ['sensitivity', 'brightness', 'volume', 'renderScale'] as const) {
    const n = data[key];
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = n;
  }
  if (typeof data.language === 'string' && /^[A-Za-z]{3}$/.test(data.language))
    result.language = data.language;
  result.sensitivity = Math.max(0.2, Math.min(3, result.sensitivity));
  result.brightness = Math.max(0.48, Math.min(1.13, result.brightness));
  result.volume = Math.max(0, Math.min(1, result.volume));
  if (![1, 0.75, 0.5].includes(result.renderScale)) result.renderScale = 1;
  return result;
}
export function brightnessIndex(value: number): number {
  return brightnessLevels.reduce<number>(
    (best, n, i) => (Math.abs(n - value) < Math.abs(brightnessLevels[best]! - value) ? i : best),
    0,
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
