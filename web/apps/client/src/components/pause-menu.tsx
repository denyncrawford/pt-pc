import { useEffect, useRef } from 'react';
import type { useSession } from '../hooks/use-session';
import { SettingsView } from '../modules/settings/web-settings';
import { EngineText } from './renderer-controls';
type Session = ReturnType<typeof useSession>;
export function PauseMenu({ session: s }: { session: Session }) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const web = s.page === 'web';
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (s.page === 'closed') node.close();
    else {
      if (!node.open) node.showModal();
      node.scrollTop = 0;
      if (web) title.current?.focus();
    }
  }, [s.page, web]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="menu-title"
      onCancel={(e) => {
        e.preventDefault();
        if (web) s.setPage('native');
        else void s.resume();
      }}
      className={
        'm-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black text-[#eee] shadow-none backdrop:bg-black/70 ' +
        (web
          ? 'overflow-auto px-[clamp(24px,6vw,120px)] py-[clamp(24px,6vh,80px)]'
          : 'overflow-hidden p-0')
      }
    >
      <h2
        ref={title}
        id="menu-title"
        tabIndex={-1}
        className={web ? 'mb-[5vh] text-[clamp(22px,2vw,32px)] font-normal' : 'sr-only'}
      >
        {web ? 'WEB SETTINGS' : 'OPTIONS'}
      </h2>
      <canvas
        ref={s.nativeCanvas}
        hidden={web}
        tabIndex={0}
        aria-label="Original options: click to select; arrow keys to adjust brightness; Z to zoom in on the image"
        className="absolute inset-0 size-full outline-none"
      />
      <section
        hidden={!web}
        className="[&_fieldset]:mb-8 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_legend]:mb-2.5 [&_legend]:w-full [&_legend]:border-b [&_legend]:border-[#202020] [&_legend]:pb-2.5 [&_legend]:text-xl [&_select]:border [&_select]:border-[#333] [&_select]:bg-[#080808] [&_select]:p-2 [&_select]:text-[#ccc] [&_input]:accent-[#ddd] [&_input[type=range]]:max-w-[45%] [&_button]:px-[18px] [&_button]:py-[9px] [&_button]:text-lg [&_button:hover]:bg-white/15 [&_button:focus-visible]:outline"
      >
        <SettingsView options={s.options} actions={s.settingsActions} change={s.configure} />
      </section>
      <EngineText
        id="menu-error"
        role="alert"
        className={
          web ? 'text-[#ffb7a3]' : 'absolute bottom-0 left-[5%] max-w-[90%] text-xs text-[#ffb7a3]'
        }
      />
      <div className={web ? 'mt-5 flex flex-wrap gap-[5vw]' : 'sr-only'}>
        {web ? (
          <button onClick={() => s.setPage('native')}>‹ Back</button>
        ) : (
          <>
            <button onClick={() => void s.resume()}>Return to game</button>
            <button onClick={() => void s.library()}>Exit to library</button>
          </>
        )}
      </div>
      <p className={web ? 'mt-[3vh] text-right text-xs tracking-wider text-[#777]' : 'sr-only'}>
        by denyncrawford and LoreanXavier
      </p>
    </dialog>
  );
}
export function RestartConfirmation({ session: s }: { session: Session }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (s.confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [s.confirm]);
  return (
    <dialog
      ref={dialog}
      onCancel={() => s.setConfirm(false)}
      className="m-auto max-w-[96vw] border border-[#333] bg-[#050606] p-6 text-[#eee] backdrop:bg-black/70"
    >
      <h2 className="mb-5 text-2xl font-normal">RESTART GAME?</h2>
      <p>Your saved progress will be reset. Your library and settings will be kept.</p>
      <div className="mt-5 flex gap-3">
        <button onClick={() => s.setConfirm(false)}>Cancel</button>
        <button onClick={() => void s.restart()}>Restart</button>
      </div>
    </dialog>
  );
}
