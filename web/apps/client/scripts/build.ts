import { build } from 'vite';
import { resolve } from 'node:path';
await build({ configFile: resolve(import.meta.dirname, '../vite.config.ts') });
