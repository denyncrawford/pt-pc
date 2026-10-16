export type ExtractRequest = { type: 'extract'; file: File } | { type: 'cancel' };
export type ExtractResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'complete' }
  | { type: 'error'; message: string };
