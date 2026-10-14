import { GraphicsControls } from '../../components/renderer-controls';
import type { GameOptions } from './options';
export interface SettingsActions {
  change(options: GameOptions): void;
  fullscreen(): void;
  restart(): void;
  capture(): void;
}
export function SettingsView({
  options,
  actions,
  change,
}: {
  options: GameOptions;
  actions: SettingsActions;
  change: (options: GameOptions) => void;
}) {
  function update<K extends keyof GameOptions>(key: K, value: GameOptions[K]) {
    const next = { ...options, [key]: value };
    change(next);
  }
  return (
    <div className="grid grid-cols-1 gap-6 min-[651px]:grid-cols-2 min-[651px]:gap-x-[60px] min-[651px]:gap-y-[30px]">
      <div>
        <fieldset>
          <legend>Pantalla</legend>
          <label className="my-2.5 flex items-center justify-between gap-4 text-sm">
            Modo de pantalla <button onClick={actions.fullscreen}>Pantalla completa</button>
          </label>
          <label className="my-2.5 flex items-center justify-between gap-4 text-sm">
            Resolución de render{' '}
            <select
              value={options.renderScale}
              onChange={(e) => update('renderScale', Number(e.currentTarget.value))}
            >
              <option value="1">100%</option>
              <option value="0.75">75%</option>
              <option value="0.5">50%</option>
            </select>
          </label>
        </fieldset>
        <fieldset id="menu-graphics">
          <legend>Gráficos</legend>
          <GraphicsControls />
        </fieldset>
      </div>
      <div>
        <fieldset>
          <legend>Sonido</legend>
          <label className="my-2.5 flex items-center justify-between gap-4 text-sm">
            Volumen{' '}
            <input
              aria-label="Volumen"
              type="range"
              min="0"
              max="100"
              value={options.volume * 100}
              onChange={(e) => update('volume', Number(e.currentTarget.value) / 100)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Controles</legend>
          <label className="my-2.5 flex items-center justify-between gap-4 text-sm">
            Sensibilidad del ratón{' '}
            <input
              aria-label="Sensibilidad del ratón"
              type="range"
              min="0.2"
              max="3"
              step="0.1"
              value={options.sensitivity}
              onChange={(e) => update('sensitivity', Number(e.currentTarget.value))}
            />
          </label>
          <p className="text-[13px] text-[#888]">
            WASD: movimiento · botón derecho: zoom · Esc: pausa
          </p>
        </fieldset>
        <fieldset>
          <legend>Partida</legend>
          <button onClick={actions.restart}>Reiniciar partida</button>
          <button onClick={actions.capture}>Ocultar menú para captura</button>
        </fieldset>
      </div>
    </div>
  );
}
