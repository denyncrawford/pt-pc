import type { WizardState } from '../../hooks/use-session';
export function WizardView({
  state,
  start,
}: {
  state: WizardState;
  start: (file?: File) => Promise<void>;
}) {
  if (state.kind === 'playing') return null;
  const loading = state.kind === 'loading';
  return (
    <section
      id="wizard"
      className="mx-auto flex min-h-dvh max-w-[680px] flex-col justify-center p-[clamp(24px,6vw,64px)] text-center"
    >
      <div className="text-xs tracking-[0.18em] text-[#b6c1b6]">P.T. / WEB</div>
      <p className="order-10 mt-12 text-xs tracking-[0.06em] text-[#a6aaa7]">
        by denyncrawford and LoreanXavier
      </p>
      <h1 className="my-4 text-[clamp(32px,6vw,52px)] font-light tracking-[0.05em]">
        {loading ? state.title : state.error ? 'No se pudo iniciar' : 'P.T.'}
      </h1>
      {!loading && (
        <>
          <p>Selecciona tu copia para comenzar.</p>
          <div className="my-[26px] flex flex-wrap justify-center gap-3">
            <label className="relative inline-block cursor-pointer rounded-xs border border-[#555] bg-transparent px-5 py-[13px] text-[#eee] hover:bg-[#333] hover:outline focus-within:outline focus-within:outline-[#eee]">
              Seleccionar PKG
              <input
                className="sr-only"
                type="file"
                accept=".pkg"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void start(file);
                }}
              />
            </label>
            {state.ready && (
              <button
                className="rounded-xs border border-[#555] bg-transparent px-5 py-[13px] text-[#eee] hover:bg-[#333] focus-visible:outline"
                onClick={() => void start()}
              >
                Jugar
              </button>
            )}
          </div>
          {state.error && (
            <p id="import-error" role="alert">
              {state.error}
            </p>
          )}
        </>
      )}
      {loading && (
        <>
          <progress
            className="my-5 h-1 w-full accent-[#ddd]"
            aria-label="Preparando archivos"
            max={state.total ?? 1}
            value={state.total ? state.done : undefined}
          />
          <p role="status">
            {state.total ? `${Math.round(((state.done ?? 0) / state.total) * 100)}%` : ''}
          </p>
        </>
      )}
    </section>
  );
}
