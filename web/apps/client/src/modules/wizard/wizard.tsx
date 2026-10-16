import type { WizardState } from '../../hooks/use-session';
export function WizardView({
  state,
  start,
  cancelImport,
  importFiles,
  storageNotice,
}: {
  cancelImport: () => void;
  importFiles: (files: readonly File[]) => Promise<void>;
  storageNotice: string;
  state: WizardState;
  start: () => Promise<void>;
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
        {loading ? state.title : state.error ? 'Could not start' : 'P.T.'}
      </h1>
      {!loading && (
        <>
          <p className="text-base leading-relaxed">
            This unofficial demo does not include or distribute P.T. or any of its game assets. You
            must provide your own lawfully obtained copy to play.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[#aaa]">
            Import a compatible fPKG or the three extracted game files. Your game files stay on this
            device and are never uploaded. Progress is saved in this browser.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[#aaa]">
            Not affiliated with or endorsed by Konami. Game content and trademarks belong to their
            respective owners.
          </p>
          {storageNotice && (
            <p role="status" className="mt-3 text-sm text-[#aaa]">
              {storageNotice}
            </p>
          )}
          <div className="my-[26px] flex flex-wrap justify-center gap-3">
            <label className="relative inline-block cursor-pointer rounded-xs border border-[#555] bg-transparent px-5 py-[13px] text-[#eee] hover:bg-[#333] hover:outline focus-within:outline focus-within:outline-[#eee]">
              Import your copy
              <input
                className="sr-only"
                type="file"
                accept=".pkg,.psarc,.qar,.bin"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  if (files.length) void importFiles(files);
                }}
              />
            </label>
            {state.ready && (
              <button
                className="rounded-xs border border-[#555] bg-transparent px-5 py-[13px] text-[#eee] hover:bg-[#333] focus-visible:outline"
                onClick={() => void start()}
              >
                Play
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
            aria-label="Preparing files"
            max={state.total ?? 1}
            value={state.total ? state.done : undefined}
          />
          {state.title !== 'Loading game' && (
            <button className="mt-4 border border-[#555] px-4 py-2" onClick={cancelImport}>
              Cancel import
            </button>
          )}
          <p role="status">
            {state.total ? `${Math.round(((state.done ?? 0) / state.total) * 100)}%` : ''}
          </p>
        </>
      )}
    </section>
  );
}
