import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const client = resolve(import.meta.dirname, '..');
const fast = [
  'stage-cycle',
  'sequence-player',
  'sequence-lights',
  'door-collision',
  'world-photo',
  'menu-photo',
  'subliminal',
  'zoom',
  'camera-blend',
  'save-game',
];
const suites = {
  fast,
  route: ['third-loop'],
  full: [
    ...fast,
    'opening',
    'two-loops',
    'f020',
    'demo-actors',
    'third-loop',
    'save-resume',
    'f060',
  ],
} satisfies Record<string, string[]>;
type Suite = keyof typeof suites;

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
async function completeLibrary(path: string): Promise<boolean> {
  return (
    (await isFile(join(path, 'manifest.json'))) &&
    (await isFile(join(path, 'chunk1.psarc'))) &&
    (await isFile(join(path, 'texture.qar')))
  );
}
async function discoverLibrary(): Promise<string> {
  const data = join(root, '.data');
  const registry = Bun.file(join(data, 'library.json'));
  if (await registry.exists()) {
    const value: unknown = await registry.json();
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      /^[a-zA-Z0-9_-]+$/.test(value.id)
    ) {
      const active = join(data, value.id);
      if (await completeLibrary(active)) return active;
      throw new Error(
        'La biblioteca activa está incompleta. Reimpórtala con el wizard o indica PT_TEST_PSARC y PT_TEST_QAR.',
      );
    }
    throw new Error('El registro de biblioteca no es válido. Indica PT_TEST_PSARC y PT_TEST_QAR.');
  }
  const entries = await readdir(data, { withFileTypes: true }).catch(() => []);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && (await completeLibrary(join(data, entry.name))))
      candidates.push(join(data, entry.name));
  }
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? 'Hay varias bibliotecas. Indica PT_TEST_PSARC y PT_TEST_QAR para elegir una.'
        : 'Faltan recursos originales. Importa tu PKG con el wizard o indica PT_TEST_PSARC y PT_TEST_QAR. No se ejecutarán pruebas omitidas como si hubieran pasado.',
    );
  return candidates[0]!;
}
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Recorridos automáticos sin imágenes ni sonido de sustos.
Uso: bun web/apps/client/scripts/test-gameplay.ts [--suite full|route|fast] [--check]
  full  Intro, tres recorridos f010 → entrada f060, Lisa, puertas, fotos y secuencias (predeterminado).
  route Solo tres recorridos completos con apariciones de Lisa y limpieza entre sesiones.
  fast  Regresiones focalizadas de puertas, fotos, reloj y secuencias.
  --check Valida biblioteca, WASM y selección sin ejecutar pruebas.
Recursos: PT_TEST_PSARC y PT_TEST_QAR; si se omiten, usa la biblioteca local activa.
Requisitos: bun install; bun run build:wasm. No necesita servidor ni navegador.
No verifica píxeles GPU, audio audible ni el baño completo de f060 o vueltas posteriores.`);
    return 0;
  }
  let suite: Suite = 'full';
  let check = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') check = true;
    else if (arg === '--suite') {
      const value = args[++i];
      if (value !== 'full' && value !== 'route' && value !== 'fast')
        throw new Error('--suite requiere full, route o fast.');
      suite = value;
    } else throw new Error(`Argumento desconocido: ${arg}. Usa --help.`);
  }
  const configuredPsarc = process.env.PT_TEST_PSARC;
  if (!configuredPsarc && process.env.PT_TEST_QAR)
    throw new Error('PT_TEST_QAR requiere también PT_TEST_PSARC.');
  const psarc = configuredPsarc
    ? resolve(configuredPsarc)
    : join(await discoverLibrary(), 'chunk1.psarc');
  const qar = process.env.PT_TEST_QAR
    ? resolve(process.env.PT_TEST_QAR)
    : join(dirname(psarc), 'texture.qar');
  if (!(await isFile(psarc)) || !(await isFile(qar)))
    throw new Error(
      'Falta chunk1.psarc o texture.qar. Indica archivos existentes; no se omitirán las pruebas.',
    );
  if ((await Bun.file(psarc).slice(0, 4).text()) !== 'PSAR' || Bun.file(qar).size === 0)
    throw new Error('Recursos vacíos o cabecera PSARC inválida. Revisa la importación.');
  for (const file of ['geometry.js', 'geometry.wasm']) {
    if (!(await isFile(join(root, 'web/packages/engine-wasm/dist', file))))
      throw new Error('Falta el núcleo WASM. Ejecuta bun run build:wasm desde la raíz.');
  }
  const files = suites[suite].map((name) => join(client, 'tests', `${name}.test.ts`));
  for (const file of files)
    if (!(await isFile(file))) throw new Error(`No existe la prueba: ${file}`);
  console.log(
    `Gameplay ${suite}: ${files.length} archivos; recursos y WASM disponibles. ${check ? 'Validación previa completada.' : 'Ejecución sin interfaz, imágenes ni sonido.'}`,
  );
  if (check) return 0;
  const started = performance.now();
  // One process, sequential tests: avoid loading the same native assets in parallel.
  const child = Bun.spawn([process.execPath, 'test', '--timeout', '300000', ...files], {
    cwd: root,
    env: { ...process.env, PT_TEST_PSARC: psarc, PT_TEST_QAR: qar },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const interrupt = () => child.kill('SIGINT');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let code: number;
  try {
    code = await child.exited;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  console.log(
    `Gameplay ${code === 0 ? 'PASS' : 'FAIL'} · ${((performance.now() - started) / 1000).toFixed(1)} s · suite ${suite}`,
  );
  return code;
}
try {
  process.exitCode = await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
