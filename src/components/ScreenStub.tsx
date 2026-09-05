import { getScreen } from "../lib/screens";
import type { ScreenId } from "../lib/screens";

interface ScreenStubProps {
  screenId: ScreenId;
  /** Phase of MAIN_PLAN.md that will implement this screen's real content. */
  phase: number;
  /** One-line description of what the screen will become (from the PRD). */
  description: string;
}

/**
 * Placeholder shared by all eight screen stubs (Phase 2). Renders the
 * terminal-style breadcrumb line plus a centered card, already wrapped in the
 * surface classes so the shell reads correctly against the designs.
 *
 * Each screen file under `src/screens/` points at its design folder
 * (`screens/<name>_typekernel/`) for the phase that fills it in.
 */
export function ScreenStub({ screenId, phase, description }: ScreenStubProps) {
  const { label, icon } = getScreen(screenId);

  return (
    <main className="flex w-full flex-1 flex-col gap-space-base bg-surface p-space-sm sm:p-space-base">
      <div className="flex items-center gap-space-xs font-code-sm text-code-sm text-on-surface-variant">
        <span className="text-primary">~</span>
        <span>/</span>
        <span>{screenId}</span>
        <span className="text-outline">//</span>
        <span>{label}</span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-space-sm rounded-xl border border-surface-container-highest/40 bg-surface-container-low px-space-lg py-space-xl text-center shadow-xl">
          <span className="material-symbols-outlined text-[32px] text-primary">
            {icon}
          </span>
          <h1 className="font-headline-md text-headline-md text-on-surface">
            {screenId} // {label}
          </h1>
          <p className="max-w-md font-body-md text-body-md text-on-surface-variant">
            {description}
          </p>
          <p className="font-code-sm text-code-sm text-primary">
            Phase {phase} will implement this screen.
          </p>
        </div>
      </div>
    </main>
  );
}
