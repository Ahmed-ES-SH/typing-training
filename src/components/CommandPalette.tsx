import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { CURRICULUM_LESSONS } from "../content";
import { cn } from "../lib/cn";
import { moduleNumber } from "../lib/format";
import {
  ALT_SCREEN_HOTKEYS,
  rankPalette,
  type PaletteDoc,
} from "../lib/hotkeys/globalHotkeys";
import { exportBackupJson } from "../lib/io/backupExport";
import { SCREENS } from "../lib/screens";
import { nextTheme, themeLabel, THEMES } from "../lib/themeCatalog";
import { lessonStatus, useCurriculumStore } from "../stores/useCurriculumStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore, type ThemeId } from "../stores/useSettingsStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Global command palette (UX plan §5.1) — `Ctrl/Cmd+K` from any screen, `/`
 * outside a run. Searches all 260 lessons by title, module number
 * (`L3-014` / `3.14`), tag and target key, plus direct screen jumps and
 * quick actions.
 *
 * The `<input>` holds focus for the whole time the palette is open — that is
 * how every other screen's `isEditableFocused()` guard knows to stand down
 * (no shared palette-state module). All key handling happens on that input,
 * which also stops propagation so screen-level window listeners (Dashboard's
 * Enter, the session's Esc, the drill's typing feed) never see a keystroke.
 */

/** Hard cap on rendered rows — the full 260 stay searchable, not mounted. */
const MAX_VISIBLE = 50;

type PaletteGroup = "screen" | "action" | "lesson";

interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  icon: string;
  title: string;
  /** Muted trailing context (tags, screen purpose…). */
  hint: string;
  /** Right-aligned badge: module code, `Locked`, `Alt+N` hotkey or group name. */
  badge: string;
  doc: PaletteDoc;
  /** Runs the entry. `false` keeps the palette open; a throw shows inline. */
  run: () => void | boolean | Promise<void | boolean>;
}

/** Stable stand-in while the palette is closed (no entry construction). */
const EMPTY_ENTRIES: PaletteEntry[] = [];

/** `l3-014` → `L3-014` (the §5.1 "module number" search form). */
function lessonCode(level: number, orderIndex: number): string {
  return `L${level}-${String(orderIndex + 1).padStart(3, "0")}`;
}

function buildLessonEntries(
  progress: Parameters<typeof lessonStatus>[0],
): PaletteEntry[] {
  return CURRICULUM_LESSONS.map((lesson) => {
    const code = lessonCode(lesson.level, lesson.orderIndex);
    // §8 sequential-unlock gate: every other surface (LessonsScreen,
    // TypingSessionScreen) refuses locked lessons — the palette must too.
    const locked = lessonStatus(progress, lesson.id) === "locked";
    return {
      id: `lesson:${lesson.id}`,
      group: "lesson" as const,
      icon: locked ? "lock" : "checklist",
      title: lesson.title,
      hint: locked
        ? [code, ...lesson.tags.slice(0, 2)].join(" · ")
        : lesson.tags.slice(0, 2).join(" · "),
      badge: locked ? "Locked" : code,
      doc: {
        title: lesson.title,
        keywords: [
          code,
          lesson.id,
          moduleNumber(lesson.level, lesson.orderIndex),
          `level ${lesson.level}`,
          ...lesson.tags,
          ...lesson.targetKeys,
          ...(locked ? ["locked"] : []),
        ],
      },
      // `false` keeps the palette open: a locked lesson stays searchable and
      // visible, it just can never be started from here.
      run: () => {
        const live = useCurriculumStore.getState().progress;
        if (lessonStatus(live, lesson.id) === "locked") return false;
        useCurriculumStore.getState().startLesson(lesson.id);
      },
    };
  });
}

function buildScreenEntries(): PaletteEntry[] {
  return SCREENS.filter(
    (screen) => screen.id !== "typing-session" && screen.id !== "lesson-results",
  ).map((screen) => {
    const alt = Object.entries(ALT_SCREEN_HOTKEYS).find(([, id]) => id === screen.id);
    return {
      id: `screen:${screen.id}`,
      group: "screen" as const,
      icon: screen.icon,
      title: `Go to ${screen.label}`,
      hint: "",
      badge: alt !== undefined ? `Alt+${alt[0]}` : "",
      doc: { title: `Go to ${screen.label}`, keywords: ["screen", "navigate", screen.id] },
      run: () => useUiStore.getState().navigate(screen.id),
    };
  });
}

/** The four quick actions (§5.1); preference toggles rebuild on store change. */
function buildActionEntries(zenMode: boolean, theme: ThemeId): PaletteEntry[] {
  const upcoming = nextTheme(theme);
  return [
    {
      id: "action:zen",
      group: "action",
      icon: "center_focus_strong",
      title: "Toggle Zen Mode",
      hint: zenMode ? "currently on" : "currently off",
      badge: "Action",
      doc: {
        title: "Toggle Zen Mode",
        keywords: ["action", "focus", "zen", "distraction"],
      },
      run: () => useSettingsStore.getState().update({ zenMode: !zenMode }),
    },
    {
      id: "action:theme",
      group: "action",
      icon: "palette",
      title: "Switch Theme",
      hint: `→ ${themeLabel(upcoming)}`,
      badge: "Action",
      doc: {
        title: "Switch Theme",
        keywords: ["action", "theme", "appearance", ...THEMES.map((t) => t.id)],
      },
      run: () => useSettingsStore.getState().update({ theme: upcoming }),
    },
    {
      id: "action:export",
      group: "action",
      icon: "ios_share",
      title: "Export Backup JSON",
      hint: "progress + custom lessons",
      badge: "Action",
      doc: {
        title: "Export Backup JSON",
        keywords: ["action", "backup", "export", "json", "save"],
      },
      run: async () => {
        const path = await exportBackupJson();
        // Cancelled dialog keeps the palette open; a throw is handled below.
        return path !== null;
      },
    },
    {
      id: "action:reset-session",
      group: "action",
      icon: "restart_alt",
      title: "Reset Session",
      hint: "clear the current buffer",
      badge: "Action",
      doc: {
        title: "Reset Session",
        keywords: ["action", "session", "reset", "restart", "clear"],
      },
      run: () => useSessionStore.getState().reset(),
    },
  ];
}

export function CommandPalette({
  open,
  onClose,
  opener,
}: {
  open: boolean;
  onClose: () => void;
  /** Element that had focus when the chord fired (captured before the
   * opener button was blurred) — handed focus back on close. */
  opener: HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  /**
   * Set when a run of an entry closed the palette: that entry owns focus
   * afterwards (navigation / toggle), so the opener must NOT get it back —
   * a focused TopBar pill would swallow the screen's Enter/Space guards.
   */
  const ranEntry = useRef(false);

  // Live preference read-outs for the two toggle actions (labels + actions
  // follow the store, never a cached copy).
  const zenMode = useSettingsStore((s) => s.settings.zenMode);
  const theme = useSettingsStore((s) => s.settings.theme);

  // Entries are built only while the palette is open: GlobalHotkeys mounts
  // this component at boot, so the ~260 lesson docs must not be constructed
  // on every app render. `progress` is a dep so freshly-completed lessons
  // flip their badge (and unlock their `run`) the moment progress changes.
  const progress = useCurriculumStore((state) => state.progress);

  const lessonEntries = useMemo(
    () => (open ? buildLessonEntries(progress) : EMPTY_ENTRIES),
    [open, progress],
  );

  const entries: PaletteEntry[] = useMemo(
    () =>
      open
        ? [
            ...buildScreenEntries(),
            ...buildActionEntries(zenMode, theme),
            ...lessonEntries,
          ]
        : EMPTY_ENTRIES,
    [open, lessonEntries, theme, zenMode],
  );

  const results = useMemo(
    () => rankPalette(query, entries, (entry) => entry.doc),
    [query, entries],
  );
  const visible = results.slice(0, MAX_VISIBLE);
  const selected = Math.min(cursor, Math.max(visible.length - 1, 0));

  // §5.1 focus discipline: reset the query, capture the element to restore
  // on close, and keep the input focused for the whole open lifetime.
  // Deliberately no `autoFocus`: React applies it during commit, BEFORE this
  // effect could read `document.activeElement`, which would capture the
  // palette's own input instead of the element to return focus to. The
  // opener prop comes from GlobalHotkeys, captured before it blurred a
  // focused button — reading activeElement here would see <body> instead.
  useEffect(() => {
    if (!open) return;
    const previous =
      opener ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    ranEntry.current = false;
    setQuery("");
    setCursor(0);
    setError(null);
    inputRef.current?.focus();
    return () => {
      // Return focus to whatever had it (e.g. the Lessons search field that
      // its own Ctrl+K handler focused the moment the palette opened).
      // The exception is a successfully-run entry (see `runEntry`): it has
      // already taken over, so focus falls to <body> instead of landing back
      // on the TopBar opener pill, whose focused state would eat the screen's
      // Enter/Space (Results retry, Dashboard resume).
      if (ranEntry.current) return;
      if (
        previous !== null &&
        previous !== document.body &&
        previous.isConnected
      ) {
        previous.focus();
      }
    };
  }, [open, opener]);

  // Escape is claimed in the CAPTURE phase: while the palette is open the
  // session/results Esc handlers (abandon run, return to curriculum) must
  // never see it — a modal that eats Esc is worse than no modal. Stacked
  // overlays: only the topmost dialog (the LAST one in document order) may
  // claim the key, or a confirm Modal opened earlier would answer Esc while
  // the palette stays up.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const root = dialogRef.current;
      if (root === null) return;
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (dialogs[dialogs.length - 1] !== root) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // Keep the highlighted row inside the scroll container.
  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, visible.length]);

  const moveSelection = (delta: number) => {
    if (visible.length === 0) return;
    setCursor((current) => {
      const base = Math.min(current, visible.length - 1);
      return (base + delta + visible.length) % visible.length;
    });
  };

  const runEntry = async (entry: PaletteEntry) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const keepOpen = await entry.run();
      if (keepOpen !== false) {
        // The entry ran: it (its navigation/toggle) owns focus from here, so
        // the close path must hand NOTHING back to the opener.
        ranEntry.current = true;
        onClose();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // The palette owns the keyboard while open: no keystroke may reach the
    // screen-level window listeners (Dashboard Enter, drill typing feed…).
    event.stopPropagation();

    const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onClose();
      return;
    }
    // `stopPropagation` above already shields the screens from this keystroke,
    // but the webview's own reload accelerator is not a DOM listener: swallow
    // Ctrl/Cmd+R so a mid-search typo can never reload the app.
    if (mod && event.key.toLowerCase() === "r") {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = visible[selected];
      if (entry !== undefined && !busy) void runEntry(entry);
      return;
    }
    if (event.key === "ArrowDown" || (mod && event.key.toLowerCase() === "n")) {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === "ArrowUp" || (mod && event.key.toLowerCase() === "p")) {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === "Tab") {
      // Modal focus stays in the query field; arrows/Enter drive the list —
      // but only while this palette is the topmost dialog (stacked overlays:
      // a confirm Modal above it would otherwise never receive Tab).
      const root = dialogRef.current;
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (root === null || dialogs[dialogs.length - 1] !== root) return;
      event.preventDefault();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-space-base pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          // Nothing inside the dialog steals focus from the query field —
          // caret placement in the input itself still works.
          if (event.target !== inputRef.current) event.preventDefault();
        }}
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-primary-container/40 bg-surface-container-low shadow-2xl"
      >
        {/* Query field */}
        <div className="flex items-center gap-space-sm border-b border-surface-container-highest/40 bg-surface-container-lowest/60 px-space-sm">
          <span className="material-symbols-outlined text-[20px] text-primary">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={visible.length > 0}
            aria-autocomplete="list"
            aria-controls={visible.length > 0 ? "palette-listbox" : undefined}
            aria-activedescendant={
              visible.length > 0 ? `palette-option-${selected}` : undefined
            }
            aria-label="Search lessons, screens and actions"
            value={query}
            placeholder="Search lessons, screens, actions… (Regex, L3-014, =>, settings)"
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent py-3 font-code-md text-code-md text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          />
          <kbd className="shrink-0 rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[11px] text-on-surface-variant">
            Esc
          </kbd>
        </div>

        {/* Results */}
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-space-xs px-space-base py-space-lg text-center">
            <span className="material-symbols-outlined text-[28px] text-outline">
              search_off
            </span>
            <p className="font-body-md text-body-md text-on-surface">
              No matches for “{query.trim()}”
            </p>
            <p className="font-code-sm text-code-sm text-on-surface-variant">
              Try a module number (L3-014), a tag (TypeScript) or a target key (=&gt;)
            </p>
          </div>
        ) : (
          <ul
            id="palette-listbox"
            role="listbox"
            aria-label="Command palette results"
            className="max-h-[52vh] overflow-y-auto p-space-xs"
          >
            {visible.map((entry, index) => {
              const isSelected = index === selected;
              return (
                <li
                  key={entry.id}
                  id={`palette-option-${index}`}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => void runEntry(entry)}
                  className={cn(
                    "flex cursor-pointer items-center gap-space-sm rounded-lg px-space-sm py-2 transition-colors",
                    isSelected
                      ? "bg-primary-container/20 text-on-surface shadow-[inset_0_0_0_1px_rgba(255,182,144,0.35)]"
                      : "text-on-surface-variant hover:bg-white/5 hover:text-on-surface",
                  )}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined shrink-0 text-[18px]",
                      isSelected ? "text-primary" : "text-outline",
                    )}
                  >
                    {entry.icon}
                  </span>
                  <span className="truncate font-body-md text-body-md">
                    {entry.title}
                  </span>
                  {entry.hint !== "" && (
                    <span className="hidden min-w-0 truncate font-code-sm text-code-sm text-outline sm:block">
                      {entry.hint}
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded px-1.5 py-0.5 font-code-sm text-[10px] uppercase tracking-wider",
                      entry.group === "lesson"
                        ? "bg-surface-container-high text-on-surface-variant"
                        : isSelected
                          ? "bg-on-primary-container/20 text-on-primary-container"
                          : "bg-surface-container-high text-outline",
                    )}
                  >
                    {entry.badge}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {error !== null && (
          <div className="flex items-center gap-space-xs border-t border-error/30 bg-error-container/20 px-space-sm py-1.5 font-code-sm text-code-sm text-error">
            <span className="material-symbols-outlined text-[14px]">error</span>
            <span className="truncate">Action failed: {error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-space-sm border-t border-surface-container-highest/40 bg-surface-container-lowest/40 px-space-sm py-1.5 font-code-sm text-code-sm text-outline">
          <span className="truncate">
            {busy
              ? "Working…"
              : `${results.length} match${results.length === 1 ? "" : "es"}` +
                (results.length > visible.length
                  ? ` — showing ${visible.length}`
                  : "")}
          </span>
          <span className="flex shrink-0 items-center gap-space-xs">
            <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px]">
              ↑↓
            </kbd>
            navigate
            <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px]">
              ⏎
            </kbd>
            run
            <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px]">
              Ctrl K
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
