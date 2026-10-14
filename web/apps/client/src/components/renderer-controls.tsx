import { useSyncExternalStore } from 'react';
import { control, rendererUi } from '../modules/renderer/renderer-elements';
export function useRendererUi() {
  useSyncExternalStore(rendererUi.subscribe, rendererUi.snapshot, rendererUi.snapshot);
}
export function GraphicsControls() {
  // The engine store mutates in place; React Compiler cannot infer these reads.
  'use no memo';
  useRendererUi();
  return (
    <>
      {(['shadows', 'reflections', 'indirect', 'mirrors'] as const).map((id, i) => (
        <label
          key={id}
          className="my-2.5 flex min-h-[38px] items-center justify-between gap-4 text-lg text-[#ccc]"
        >
          {['Sombras', 'Reflejos', 'Luz indirecta', 'Espejo'][i]}
          <input
            id={id}
            type="checkbox"
            className="accent-[#ddd]"
            checked={control(id).checked}
            onChange={(e) => {
              control(id).checked = e.currentTarget.checked;
              control(id).onchange();
            }}
          />
        </label>
      ))}
    </>
  );
}
export function EngineText({
  id,
  className = '',
  role,
}: {
  id: string;
  className?: string;
  role?: 'status' | 'alert';
}) {
  // The engine store mutates in place; React Compiler cannot infer these reads.
  'use no memo';
  useRendererUi();
  return (
    <div id={id} className={className} role={role}>
      {control(id).textContent}
    </div>
  );
}
export function DeveloperTools() {
  // The engine store mutates in place; React Compiler cannot infer these reads.
  'use no memo';
  useRendererUi();
  const models = control('models');
  return (
    <details>
      <summary className="cursor-pointer">Herramientas de desarrollo</summary>
      <div className="my-3 flex flex-wrap gap-2.5">
        <button onClick={() => control('inspect-mirror').click()}>Probar espejo</button>
        <button onClick={() => control('demo').click()}>Pasillo de prueba</button>
        <label className="cursor-pointer rounded-lg border border-[#526149] px-5 py-3">
          Abrir archivo
          <input
            className="sr-only"
            type="file"
            accept=".psarc,.fpk,.fpkd,.fmdl"
            multiple
            disabled={control('files').disabled}
            onChange={(e) => {
              control('files').files = Array.from(e.currentTarget.files ?? []);
              control('files').onchange();
            }}
          />
        </label>
        <select
          aria-label="Modelo del archivo"
          value={models.value}
          disabled={models.disabled}
          className="max-w-full bg-[#27332a] p-2"
          onChange={(e) => {
            models.value = e.currentTarget.value;
            models.onchange();
          }}
        >
          {models.choices.length ? (
            models.choices.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))
          ) : (
            <option value="">Selecciona archivos locales</option>
          )}
        </select>
      </div>
      <EngineText id="audio-meter" />
      <EngineText id="walk-debug" />
    </details>
  );
}
