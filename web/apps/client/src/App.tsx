import { useSession } from './hooks/use-session';
import { WizardView } from './modules/wizard/wizard';
import { GameViewport } from './components/game-viewport';
import { PauseMenu, RestartConfirmation } from './components/pause-menu';
import type { RuntimeLoader } from './types/game-runtime';
export function App({ loadRuntime }: { loadRuntime: RuntimeLoader }) {
  const session = useSession(loadRuntime);
  return (
    <main
      className={
        'min-h-dvh font-sans ' +
        (session.development ? 'bg-[#101512] text-[#edf1e9]' : 'bg-[#050606] text-[#eee]')
      }
    >
      <WizardView state={session.wizard} start={session.start} />
      <GameViewport session={session} />
      <PauseMenu session={session} />
      <RestartConfirmation session={session} />
      {session.playing && !session.started && (
        <div className="fixed inset-0 z-4 grid place-content-center bg-black/65 text-center">
          <button
            onClick={session.begin}
            className="rounded-xs border border-[#888] bg-[#111] px-12 py-[18px] text-white"
          >
            Comenzar
          </button>
        </div>
      )}
    </main>
  );
}
