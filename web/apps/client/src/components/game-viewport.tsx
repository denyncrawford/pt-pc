import { bindPrefaceCanvas } from '../modules/renderer/renderer-elements';
import type { useSession } from '../hooks/use-session';
import { bindCanvas, control } from '../modules/renderer/renderer-elements';
import { DeveloperTools, EngineText, useRendererUi } from './renderer-controls';
type Session = ReturnType<typeof useSession>;
export function GameViewport({ session: s }: { session: Session }) {
  // The engine store mutates in place; React Compiler cannot infer these reads.
  'use no memo';
  useRendererUi();
  const notice = control('stage-loading');
  return (
    <section
      ref={s.viewer}
      id="viewer"
      hidden={!s.playing}
      className={
        s.development ? 'flex min-h-dvh flex-col' : 'flex h-dvh flex-col justify-center bg-black'
      }
    >
      {s.saveError && (
        <div
          role="alert"
          className="absolute left-4 top-4 z-10 max-w-sm bg-black/90 p-4 text-white"
        >
          <p>{s.saveError}</p>
          <button onClick={s.retrySave} className="mt-2 border px-3 py-2">
            Reintentar guardado
          </button>
        </div>
      )}
      <header
        className={
          s.development ? 'border-b border-[#364336] px-6 py-[18px]' : 'absolute right-4 top-3 z-3'
        }
      >
        {s.development && (
          <>
            <h1 className="my-4 text-[22px]">P.T. · Web</h1>
            <small>by denyncrawford and LoreanXavier</small>
          </>
        )}
        <div className="my-3 flex flex-wrap gap-2.5">
          {s.development && <button onClick={s.begin}>Jugar</button>}
          <button
            hidden={s.capture}
            onClick={s.openMenu}
            className="rounded-xs border border-[#555] bg-black/50 px-5 py-[13px] text-[#eee]"
          >
            Pausa / Opciones
          </button>
          {s.development && (
            <>
              <button onClick={() => control('reset').click()}>Volver al inicio</button>
              <button onClick={() => void s.library()}>Biblioteca</button>
            </>
          )}
        </div>
        {s.development && (
          <>
            <small>WASD: mover · ratón: mirar · R: inicio · Esc: pausa.</small>
            <DeveloperTools />
            <EngineText id="error" role="alert" className="whitespace-pre-wrap text-[#ffb7a3]" />
          </>
        )}
      </header>
      <div
        className={
          'relative aspect-video flex-none overflow-hidden ' +
          (s.development ? 'w-full' : 'max-h-dvh w-[min(100vw,177.7778dvh)] self-center')
        }
      >
        <canvas ref={bindCanvas} id="canvas" className="block size-full min-h-0" />
        <div
          className="pointer-events-none absolute inset-0 bg-black"
          style={{ opacity: Number(control('opening-fade').style.opacity) }}
        />
        <canvas
          ref={bindPrefaceCanvas}
          hidden={control('preface').hidden}
          className="pointer-events-none absolute inset-0 size-full bg-black"
          aria-label="Apertura original"
        />
        <div
          hidden={control('preface').hidden}
          className="pointer-events-none absolute inset-x-[8%] bottom-[22px] whitespace-pre-line text-center text-lg leading-[1.45] text-white"
        >
          {control('preface-caption').textContent}
        </div>
        <div
          id="subtitles"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-[8%] bottom-[22px] whitespace-pre-line text-center text-lg leading-[1.45] text-white [text-shadow:0_2px_3px_black,0_0_5px_black]"
        >
          {control('subtitles').textContent}
        </div>
        <button
          hidden={notice.hidden}
          disabled={notice.disabled}
          onClick={() => notice.click()}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#111c] px-5 py-3 text-white"
          aria-live="polite"
        >
          {notice.textContent || 'Preparando pasillo'}
        </button>
      </div>
      {s.development && (
        <>
          <EngineText id="audio-status" role="status" className="px-6 text-[13px]" />
          <EngineText
            id="status"
            role="status"
            className="whitespace-pre-wrap px-6 py-2.5 text-[13px]"
          />
        </>
      )}
    </section>
  );
}
