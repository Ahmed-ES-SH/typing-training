import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { lessonsByLevel, getLevelMeta } from "../content";
import { KeyboardVisualization } from "../components/KeyboardVisualization";
import { KeyHeatmapCompact } from "../components/KeyHeatmapCompact";
import { StatusPill } from "../components/StatusPill";
import { findTargetKey, FINGERS, getActiveLayout } from "../lib/layout";
import { getCharAccuracy, type CharAccuracy } from "../lib/intelligence/heatmap";
import { fmt1, fmtClock, moduleNumber } from "../lib/format";
import { isHeatmapToggle, isInstantReset, isTabResetChord, isZenToggle } from "../lib/session/goldenLoop";
import { isEditableFocused, releaseChromeFocus } from "../lib/session/focusShield";
import { WPM_GATE } from "../lib/curriculum/rules";
import { liveMetrics } from "../lib/engine/metrics";
import type { SessionState } from "../lib/engine/types";
import type { Lesson } from "../lib/schemas";
import { cn } from "../lib/cn";
import { lessonStatus, useCurriculumStore } from "../stores/useCurriculumStore";
import { resolveTypingLesson } from "../stores/useCustomLessonsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Typing Session screen — implemented from `screens/current_lesson_typekernel`
 * (design `code.html`): module sidebar, full-focus code buffer with per-char
 * evaluation, live telemetry strip and on-screen keyboard.
 *
 * Sidebar module states (✓ completed / running / next / 🔒 locked) come from
 * the real curriculum + `lesson_progress` rows (Phase 4). The lesson is
 * selected through navigation params; finishing routes to the Results screen.
 *
 * Keyboard-first (UX plan §4.1 + Phase 4 §7.3): Tab+Enter / Ctrl+R instant
 * reset, Esc to curriculum, F / Ctrl+Shift+F Zen Mode and H / Ctrl+Shift+H
 * for the in-session key-heatmap glance — all behind the §4.1.4 focus shield.
 */

/* ---------------------------------------------------------------------------
 * Sidebar
 * ------------------------------------------------------------------------- */

type ModuleState = "completed" | "running" | "next" | "locked";

function moduleStateOf(
  lesson: Lesson,
  activeLessonId: string | null,
  progress: Record<string, import("../lib/schemas").LessonProgress>,
): ModuleState {
  if (lesson.id === activeLessonId) return "running";
  switch (lessonStatus(progress, lesson.id)) {
    case "completed":
      return "completed";
    case "available":
      return "next";
    default:
      return "locked";
  }
}

/* ---------------------------------------------------------------------------
 * Small helpers (number/time rendering comes from the shared `lib/format`
 * util — Phase 8 §3.5; no ad-hoc decimals or clocks here)
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Sidebar
 * ------------------------------------------------------------------------- */

function ModuleCard({ lesson, state, progress, onSelect }: {
  lesson: Lesson;
  state: ModuleState;
  progress?: import("../lib/schemas").LessonProgress;
  onSelect: (lesson: Lesson) => void;
}) {
  const num = moduleNumber(lesson.level, lesson.orderIndex);
  const tokens = `Tokens: ${lesson.targetKeys.slice(0, 4).join(" ")}`;

  if (state === "running") {
    return (
      <div className="rounded-lg border border-surface-container-highest/40 bg-surface-container-high p-space-sm shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-container" />
            </span>
            <span className="font-code-sm text-code-sm font-bold text-primary">
              {num} {lesson.title}
            </span>
          </div>
          <StatusPill tone="inProgress">In progress</StatusPill>
        </div>
        <div className="flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
          <span className="text-primary-fixed">{tokens}</span>
          {progress && progress.bestWpm > 0 && (
            <span className="font-semibold text-on-surface">Best: {fmt1(progress.bestWpm)} WPM</span>
          )}
        </div>
      </div>
    );
  }

  if (state === "completed") {
    return (
      <button
        type="button"
        onClick={() => onSelect(lesson)}
        className="group w-full rounded-lg border border-transparent bg-surface-container-lowest/70 p-space-sm text-left shadow-sm transition-all hover:border-surface-container-highest/60 hover:bg-surface-container"
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span
              className="material-symbols-outlined text-[16px] text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            <span className="font-code-sm text-code-sm font-semibold text-on-surface">
              {num} {lesson.title}
            </span>
          </div>
          <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-code-sm text-code-sm text-primary">
            {progress ? progress.bestWpm.toFixed(0) : 0} WPM
          </span>
        </div>
        <div className="flex items-center justify-between pl-6 font-code-sm text-code-sm text-on-surface-variant">
          <span className="text-outline">{tokens}</span>
          <span>{progress ? progress.bestAccuracy.toFixed(0) : 0}% Acc</span>
        </div>
      </button>
    );
  }

  if (state === "next") {
    return (
      <button
        type="button"
        onClick={() => onSelect(lesson)}
        className="w-full rounded-lg bg-surface-container-lowest/50 p-space-sm text-left shadow-sm opacity-90 transition-all hover:bg-surface-container"
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
              lock_open
            </span>
            <span className="font-code-sm text-code-sm font-medium text-on-surface">
              {num} {lesson.title}
            </span>
          </div>
          <StatusPill tone="available">Next</StatusPill>
        </div>
        <div className="flex items-center justify-between pl-6 font-code-sm text-code-sm text-on-surface-variant">
          <span className="text-outline">{tokens}</span>
          <span>Pending</span>
        </div>
      </button>
    );
  }

  // locked
  return (
    <div className="rounded-lg bg-surface-container-lowest/20 p-space-sm opacity-50">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-[16px] text-outline">lock</span>
          <span className="font-code-sm text-code-sm text-on-surface-variant">
            {num} {lesson.title}
          </span>
        </div>
        <StatusPill tone="locked">Locked</StatusPill>
      </div>
      <div className="pl-6 font-code-sm text-code-sm text-outline">{tokens}</div>
    </div>
  );
}

function ModuleSidebar({
  lesson,
  activeLessonId,
  progress,
  onSelect,
  zen = false,
}: {
  lesson: Lesson | null;
  activeLessonId: string | null;
  progress: Record<string, import("../lib/schemas").LessonProgress>;
  onSelect: (lesson: Lesson) => void;
  /** UX plan §4.1.3 — the rail smoothly collapses to zero width in Zen Mode. */
  zen?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Ctrl+B is the documented toggle (kbd hint in the footer) — without this
  // handler a collapsed drawer could never be restored from the keyboard.
  // §4.1.4: an editable field owns its keystrokes (palette interop).
  useEffect(() => {
    const onToggle = (event: KeyboardEvent) => {
      if (isEditableFocused()) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onToggle);
    return () => window.removeEventListener("keydown", onToggle);
  }, []);
  const [tab, setTab] = useState<"all" | "remaining">("all");
  const level = lesson?.level ?? 1;
  const meta = getLevelMeta(level);
  const levelLessons = useMemo(() => lessonsByLevel(level), [level]);
  const completed = levelLessons.filter(
    (l) => lessonStatus(progress, l.id) === "completed",
  ).length;
  const visibleLessons = levelLessons.filter((l) => {
    if (tab === "all") return true;
    return lessonStatus(progress, l.id) !== "completed" || l.id === activeLessonId;
  });

  return (
    <aside
      // Collapsed in Zen Mode: out of the tab order too, so hidden lesson
      // links can never steal focus from the buffer (§4.1.3).
      inert={zen}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-xl border border-surface-container-highest/30 bg-surface-container-low shadow-2xl transition-all duration-300",
        zen
          ? "pointer-events-none w-0 border-0 opacity-0"
          : "w-80 opacity-100 lg:w-88 xl:w-96",
        !zen && collapsed ? "hidden" : "",
      )}
    >
      {/* Track header */}
      <div className="relative overflow-hidden border-b border-surface-container-highest/40 bg-gradient-to-b from-surface-container-high/40 to-transparent p-space-base">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary-container/15 blur-2xl" />
        <div className="mb-1.5 flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
          <span className="font-bold tracking-wider text-primary">
            Level {level}
          </span>
          <span className="rounded bg-surface-container px-space-xs py-0.5 font-code-sm font-bold text-primary">
            {completed}/{levelLessons.length}
          </span>
        </div>
        <h2 className="mb-2 font-headline-md text-headline-md leading-snug tracking-tight text-on-surface">
          {meta?.name ?? "Curriculum"}
        </h2>
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
          <div
            className="h-full bg-gradient-to-r from-secondary-container via-primary-container to-primary"
            style={{
              width: `${levelLessons.length ? Math.round((completed / levelLessons.length) * 100) : 0}%`,
            }}
          />
        </div>
        <div className="flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
          <span>
            {levelLessons.length ? Math.round((completed / levelLessons.length) * 100) : 0}% Completed
          </span>
          <span className="font-medium text-primary-container">
            {levelLessons.length - completed} lessons remaining
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-col gap-1.5 border-b border-white/5 bg-surface-container-lowest/40 p-space-xs">
        <div className="flex items-center gap-1 rounded-lg bg-surface-container-lowest p-1 font-label-sm text-label-sm text-on-surface-variant">
          <button
            type="button"
            onClick={() => setTab("all")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-center transition-colors",
              tab === "all"
                ? "bg-surface-container-high font-bold text-primary shadow-sm"
                : "hover:bg-surface-container",
            )}
          >
            All ({levelLessons.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("remaining")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-center transition-colors",
              tab === "remaining"
                ? "bg-surface-container-high font-bold text-primary shadow-sm"
                : "hover:bg-surface-container",
            )}
          >
            Remaining ({levelLessons.length - completed})
          </button>
        </div>
      </div>

      {/* Module list */}
      <div className="flex flex-1 flex-col gap-space-xs overflow-y-auto p-space-sm">
        {visibleLessons.map((l) => (
          <ModuleCard
            key={l.id}
            lesson={l}
            state={moduleStateOf(l, activeLessonId, progress)}
            progress={progress[l.id]}
            onSelect={(selected) => {
              if (selected.id !== activeLessonId) onSelect(selected);
            }}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-surface-container-highest/40 bg-surface-container-lowest/60 p-space-sm">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex w-full items-center justify-between rounded-lg bg-surface-container px-space-sm py-2 font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">keyboard_double_arrow_left</span>
            <span>Collapse Drawer</span>
          </span>
          <kbd className="rounded border border-surface-container-highest/50 bg-surface-container-lowest px-1.5 py-0.5 font-code-sm text-code-sm text-outline">
            Ctrl+B
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().navigate("lessons")}
          className="flex w-full items-center justify-center gap-1.5 rounded py-1.5 font-label-md text-label-md text-primary transition-colors hover:text-primary-fixed"
        >
          <span className="material-symbols-outlined text-[16px]">map</span>
          <span>Full Curriculum Map</span>
        </button>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * Code buffer
 * ------------------------------------------------------------------------- */

interface DisplayLine {
  text: string;
  /** Global index of the line's first char (the newline occupies one entry). */
  offset: number;
}

function CodeBuffer({ lesson, engineState, running, bestWpm, zen = false }: {
  lesson: Lesson | null;
  engineState: SessionState;
  running: boolean;
  /** Personal best for this lesson (0 = none yet) — shown as the target hint. */
  bestWpm: number;
  /** UX plan §4.1.3 — Zen Mode: no editor chrome, 24px buffer, full viewport. */
  zen?: boolean;
}) {
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  /** UX plan §4.1.4 — faint `·` indent dots + `⏎` newline markers. */
  const whitespaceGlyphs = useSettingsStore((s) => s.settings.whitespaceGlyphs);

  const lines = useMemo<DisplayLine[]>(() => {
    const result: DisplayLine[] = [];
    let offset = 0;
    for (const text of engineState.content.split("\n")) {
      result.push({ text, offset });
      offset += text.length + 1;
    }
    return result;
  }, [engineState.content]);

  // The line the caret currently sits on (also line-end positions, where the
  // next char is the line's newline).
  const activeLine = lines.findIndex(
    (line) =>
      engineState.position >= line.offset &&
      engineState.position <= line.offset + line.text.length,
  );

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "nearest" });
  }, [engineState.position]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest shadow-2xl">
      {/* Editor header — lesson title + subtle target hint (hidden in Zen) */}
      {!zen && (
      <div className="flex shrink-0 items-center justify-between gap-space-sm border-b border-white/5 bg-surface-container-low px-space-base py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined shrink-0 text-[16px] text-primary">description</span>
          <span className="truncate font-label-md text-label-md font-semibold text-on-surface">
            {lesson
              ? `Lesson ${moduleNumber(lesson.level, lesson.orderIndex)} — ${lesson.title}`
              : "No lesson selected"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
          <span className="hidden sm:inline">
            Level {lesson?.level ?? 1} • {getLevelMeta(lesson?.level ?? 1)?.tagline ?? "Ready"}
          </span>
          <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-medium text-primary">
            {bestWpm > 0
              ? `Best ${fmt1(bestWpm)} WPM`
              : `Target > ${WPM_GATE} WPM`}
          </span>
        </div>
      </div>
      )}

      {/* Buffer body */}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-auto p-space-base font-code-lg sm:p-space-lg",
          zen
            ? "text-[24px] leading-[3rem]"
            : "text-[20px] leading-[2.5rem]",
        )}
      >
        {lines.map((line, lineIndex) => {
          const isActive = lineIndex === activeLine && running;
          const caretAtLineEnd =
            running && engineState.position === line.offset + line.text.length;
          /** §4.1.4 — how many leading spaces make up this line's indent. */
          const indentWidth = line.text.length - line.text.trimStart().length;
          /** The last line has no trailing newline to mark. */
          const hasNewline = lineIndex < lines.length - 1;
          return (
            <div
              key={lineIndex}
              ref={isActive ? activeLineRef : undefined}
              className={`flex items-center rounded-md ${
                isActive ? "-mx-1 bg-surface-container-high/60 px-1 py-1 shadow-inner" : ""
              }`}
            >
              <span
                className={`w-12 select-none pr-5 text-right font-code-sm text-code-sm ${
                  isActive ? "font-bold text-primary" : "text-outline-variant"
                }`}
              >
                {lineIndex + 1}
              </span>
              <span className="whitespace-pre">
                {line.text.length === 0 && !caretAtLineEnd ? (
                  "\u00A0"
                ) : (
                  Array.from(line.text).map((expected, i) => {
                    const globalIndex = line.offset + i;
                    const entry = engineState.entries[globalIndex];
                    if (entry === undefined) return null;
                    const isCurrent = running && globalIndex === engineState.position;
                    /** §4.1.4 — indent dots make the leading run unmistakable. */
                    const isIndentDot =
                      whitespaceGlyphs && expected === " " && i < indentWidth;

                    const statusClass =
                      entry.status === "correct"
                        ? "text-on-surface"
                        : entry.status === "incorrect"
                          ? "rounded bg-error-container text-on-error-container"
                          : "text-outline opacity-70";

                    return (
                      <span key={globalIndex} className="relative inline-block">
                        {isCurrent && (
                          <span className="absolute -left-0.5 top-1/2 h-7 w-0.5 -translate-y-1/2 animate-pulse bg-primary" />
                        )}
                        <span
                          className={
                            isCurrent
                              ? "rounded border border-primary-container/50 bg-primary-container/25 px-0.5 text-primary"
                              : entry.status !== "incorrect" && isIndentDot
                                ? "text-outline/70"
                                : statusClass
                          }
                        >
                          {entry.status === "incorrect" && entry.typed !== null
                            ? entry.typed
                            : expected === " "
                              ? isIndentDot
                                ? "\u00B7"
                                : "\u00A0"
                              : expected}
                        </span>
                      </span>
                    );
                  })
                )}
                {caretAtLineEnd && (
                  <span className="ml-0.5 inline-block h-7 w-2.5 animate-pulse bg-primary-container" />
                )}
                {/* §4.1.4 — the newline the caret is parked on, made visible. */}
                {caretAtLineEnd && hasNewline && whitespaceGlyphs && (
                  <span className="ml-1 select-none text-[0.8em] leading-none text-outline/70">
                    ⏎
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Screen
 * ------------------------------------------------------------------------- */

export default function TypingSessionScreen() {
  const phase = useSessionStore((s) => s.phase);
  const lesson = useSessionStore((s) => s.lesson);
  const engineState = useSessionStore((s) => s.engineState);
  const now = useSessionStore((s) => s.now);
  const summary = useSessionStore((s) => s.summary);
  const persistError = useSessionStore((s) => s.persistError);
  const startLesson = useSessionStore((s) => s.startLesson);
  const typeChar = useSessionStore((s) => s.typeChar);
  const backspace = useSessionStore((s) => s.backspace);
  const retryPersist = useSessionStore((s) => s.retryPersist);
  const sessionParams = useUiStore((s) => s.params["typing-session"]);
  const progress = useCurriculumStore((s) => s.progress);

  // §4.1.3 — Zen / Focus Mode: state lives in `settings.zenMode` so it
  // survives restarts and is shared with the Settings screen.
  const zen = useSettingsStore((s) => s.settings.zenMode);
  // Keyboard-guide display settings — live selectors (same pattern as
  // `whitespaceGlyphs` in CodeBuffer): reading getState() during render
  // would never repaint when Settings toggles them.
  const highlightNextKey = useSettingsStore((s) => s.settings.highlightNextKey);
  const fingerGuides = useSettingsStore((s) => s.settings.fingerGuides);
  const toggleZen = useCallback(() => {
    const { settings, update } = useSettingsStore.getState();
    update({ zenMode: !settings.zenMode });
  }, []);

  // §4.1.2 — instant, dialog-free restart of the current buffer.
  const restart = useCallback(() => {
    const current = useSessionStore.getState().lesson;
    if (current !== null) void startLesson(current);
  }, [startLesson]);

  // §14 compact heatmap: data loads once on first toggle (never per
  // keystroke), and the toggle itself never steals keystroke focus.
  const [heatmapVisible, setHeatmapVisible] = useState(false);
  const [heatmapData, setHeatmapData] = useState<CharAccuracy[]>([]);
  useEffect(() => {
    if (!heatmapVisible || heatmapData.length > 0) return;
    let cancelled = false;
    void getCharAccuracy("30d")
      .then((data) => {
        if (!cancelled) setHeatmapData(data);
      })
      .catch(() => {
        // DB unavailable — the heatmap renders its empty state.
        if (!cancelled) setHeatmapData([]);
      });
    return () => {
      cancelled = true;
    };
  }, [heatmapVisible, heatmapData.length]);

  // Start the param-selected lesson exactly once per navigation (§3.8):
  // the store resets to idle when a lesson is chosen elsewhere. Curriculum
  // ids resolve from the bundled content; `custom-<uuid>` refs load the
  // user's module from the DB (Phase 7 §16).
  const startedFor = useRef<string | null>(null);
  /**
   * §4.1.2 — key held while a reset chord fired (Tab+Enter / Ctrl+R): its
   * auto-repeat is swallowed by the typing feed until the key comes back
   * up, so a held Enter can never leak newlines into the fresh buffer.
   */
  const suppressUntilKeyup = useRef<string | null>(null);
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (suppressUntilKeyup.current === event.key) suppressUntilKeyup.current = null;
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, []);
  useEffect(() => {
    const lessonId = sessionParams?.lessonId ?? null;
    if (phase === "idle" && lessonId !== null && startedFor.current !== lessonId) {
      // The DB read below is async: leaving the screen (Esc/navigate) before
      // it resolves must not start a zombie session afterwards — its 200 ms
      // interval and open training_sessions row would outlive the screen.
      let cancelled = false;
      void resolveTypingLesson(lessonId)
        .then((selected) => {
          if (cancelled) return;
          if (selected) {
            startedFor.current = lessonId;
            void startLesson(selected);
          }
        })
        .catch(() => {
          // Deleted custom module / DB failure — "No module loaded" state
          // already renders; just don't leave an unhandled rejection.
        });
      return () => {
        cancelled = true;
      };
    }
  }, [phase, sessionParams, startLesson]);

  // §3.7 abandon path: leaving an ACTIVE session via any navigation closes
  // its training_sessions row and writes no attempt row.
  useEffect(() => {
    return () => {
      void useSessionStore.getState().abandon();
    };
  }, []);

  // Esc backs out to the module list (the abandon above closes the session
  // row on unmount — same semantics as the Weakness screen's Esc). §4.1.4:
  // while an editable field owns the keystroke the Esc belongs to it (an
  // open Command Palette must close, never abandon the session).
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isEditableFocused()) return;
      event.preventDefault();
      useUiStore.getState().navigate("lessons");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  // §4.1.3 Zen / Focus Mode + §7.3 Heatmap Glance. The chords (Ctrl+Shift+F
  // / Ctrl+Shift+H) are always available; the bare `F` / `H` are only
  // claimed while nothing is being typed, because `f` and `h` are ordinary
  // lesson characters and binding them mid-run would eat input. §4.1.4: an
  // editable field (palette input) keeps every keystroke.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditableFocused()) return;
      if (isZenToggle(event, phase === "running")) {
        event.preventDefault();
        toggleZen();
        return;
      }
      if (isHeatmapToggle(event, phase === "running")) {
        event.preventDefault();
        setHeatmapVisible((visible) => !visible);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleZen]);

  // Global keydown listener — active only while a session is running.
  // §4.1.2: Tab+Enter and Ctrl+R restart the buffer with no confirmation
  // dialog; §4.1.4: a control left focused by a stray click is released
  // first so window chrome can never swallow Space/Enter.
  useEffect(() => {
    if (phase !== "running") return;
    /** Timestamp of the last Tab press — armed half of the Tab+Enter chord. */
    let tabArmedAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      // IME composition: the composing keydown reports the pending key, not
      // a committed character — it must never reach the buffer.
      if (event.isComposing || event.keyCode === 229) return;
      // §4.1.2 — Ctrl+R / Cmd+R restarts the buffer with no confirmation
      // dialog; every other modifier combo passes through to the shell.
      // Holding the chord restarts once — a repeat tick must not re-fire it.
      if (event.ctrlKey || event.metaKey) {
        if (event.repeat) return;
        if (isInstantReset(event)) {
          event.preventDefault();
          suppressUntilKeyup.current = event.key;
          restart();
        }
        return;
      }
      if (event.altKey) return;

      // NOTE: the typing paths below (Tab/Backspace/Enter/characters) MUST
      // accept `event.repeat` — holding a key or Backspace repeats on purpose.
      // §4.1.4 focus shield: an editable field keeps its keystrokes; chrome a
      // stray click left focused is released so it cannot swallow Space/Enter.
      if (isEditableFocused()) return;
      releaseChromeFocus();
      // …except the key that just fired a reset chord: its auto-repeat must
      // not leak into the buffer the chord just created.
      if (event.repeat && suppressUntilKeyup.current === event.key) return;

      if (isTabResetChord(event, tabArmedAt, Date.now())) {
        event.preventDefault();
        tabArmedAt = 0;
        suppressUntilKeyup.current = event.key;
        restart();
        return;
      }
      if (event.key === "Tab") {
        // Documented choice: Tab inserts a space (content never has tabs)
        // AND arms the Tab+Enter reset chord.
        event.preventDefault();
        tabArmedAt = Date.now();
        typeChar(" ");
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        typeChar("\n");
      } else if (event.key.length === 1) {
        event.preventDefault();
        typeChar(event.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, typeChar, backspace, restart]);

  const running = phase === "running";
  const metrics = engineState !== null ? liveMetrics(engineState, now) : null;
  const nextCharValue =
    engineState !== null && running
      ? (engineState.entries[engineState.position]?.expected ?? null)
      : null;

  const nextTarget = nextCharValue !== null ? findTargetKey(getActiveLayout(), nextCharValue) : null;
  const nextFinger = nextTarget !== null ? FINGERS[nextTarget.key.finger] : null;
  const upcoming = engineState?.content.slice(
    engineState.position,
    engineState.position + 2,
  ) ?? "";

  return (
    <main
      className={cn(
        "flex min-h-0 w-full flex-1 overflow-hidden bg-surface",
        zen ? "gap-0 p-0" : "gap-space-sm p-space-sm sm:p-space-base",
      )}
    >
      <ModuleSidebar
        lesson={lesson}
        activeLessonId={lesson?.id ?? null}
        progress={progress}
        onSelect={(selected) => void startLesson(selected)}
        zen={zen}
      />

      <section className="relative flex h-full min-w-0 flex-1 flex-col gap-space-sm overflow-hidden">
        {/* Telemetry & controls — replaced by the faint Zen HUD in Focus Mode */}
        {!zen && (
        <div className="flex shrink-0 flex-col gap-space-sm rounded-xl border border-surface-container-highest/30 bg-surface-container-low p-space-sm shadow-md sm:p-space-base">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <div className="flex flex-wrap items-center gap-space-md sm:gap-space-lg">
              {/* WPM */}
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline-xl text-headline-xl font-bold tracking-tight text-primary">
                  {metrics ? fmt1(metrics.wpm) : "0.0"}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">WPM</span>
              </div>
              <div className="h-6 w-px bg-white/10" />
              {/* Accuracy */}
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline-xl text-headline-xl font-bold tracking-tight text-on-surface">
                  {metrics ? fmt1(metrics.accuracy) : "100.0"}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">Accuracy %</span>
              </div>
              <div className="h-6 w-px bg-white/10" />
              {/* Progress */}
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline-xl text-headline-xl font-bold tracking-tight text-on-surface">
                  {metrics ? Math.round(metrics.progressPct) : 0}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">Progress %</span>
              </div>
              <div className="h-6 w-px bg-white/10" />
              {/* Elapsed */}
              <div className="flex items-center gap-1 text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px] text-primary">timer</span>
                <span className="font-label-md text-label-md font-medium">
                  {metrics ? fmtClock(metrics.elapsedMs) : "00:00"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-space-xs">
              <button
                type="button"
                onClick={() => lesson && void startLesson(lesson)}
                className="flex items-center gap-1 rounded-lg border border-surface-container-highest/40 bg-surface-container px-3 py-1.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
                title="Restart lesson (Tab then Enter, or Ctrl+R)"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Reset</span>
                <kbd className="hidden rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant md:inline">
                  Ctrl+R
                </kbd>
              </button>
              {/* §4.1.3 — compact Zen Mode toggle (keyboard: Ctrl+Shift+F). */}
              <button
                type="button"
                onClick={toggleZen}
                aria-pressed={zen}
                className="flex items-center gap-1 rounded-lg border border-surface-container-highest/40 bg-surface-container px-3 py-1.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
                title="Zen / Focus Mode (Ctrl+Shift+F)"
              >
                <span className="material-symbols-outlined text-[16px]">fullscreen</span>
                <span>Zen</span>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex flex-col gap-1">
            <div className="relative h-2 w-full overflow-hidden rounded-full border border-surface-container-highest/30 bg-surface-container-lowest">
              <div
                className="h-full rounded-full bg-gradient-to-r from-secondary-container via-primary-container to-primary transition-all duration-300"
                style={{ width: `${metrics ? Math.min(100, metrics.progressPct) : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
              <span>
                {engineState?.position ?? 0} of {engineState?.entries.length ?? 0} characters
              </span>
              <span className="font-semibold text-primary">
                {metrics ? Math.round(metrics.progressPct) : 0}%
              </span>
            </div>
          </div>
        </div>
        )}

        {/* Save-failure banner — stays visible in Zen Mode too. */}
        {persistError !== null && (
          <div className="flex shrink-0 items-center justify-between gap-2 rounded border border-error/40 bg-error-container/40 px-space-sm py-1 font-code-sm text-code-sm text-error">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">error</span>
              Save failed: {persistError}
            </span>
            <button
              type="button"
              onClick={() => void retryPersist()}
              className="rounded bg-surface-container px-2 py-0.5 font-bold text-on-surface hover:bg-surface-container-high"
            >
              Retry save
            </button>
          </div>
        )}

        {/* §4.1.3 — minimalist floating HUD: faint WPM / Accuracy / Progress. */}
        {zen && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-space-md border border-white/5 bg-surface-container-low/70 px-space-md py-1.5 font-label-sm text-label-sm text-on-surface-variant opacity-80 sm:gap-space-lg">
            <span className="flex items-baseline gap-1.5">
              <strong className="font-mono text-[15px] font-bold text-primary">
                {metrics ? fmt1(metrics.wpm) : "0.0"}
              </strong>
              <span className="tracking-widest">WPM</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <strong className="font-mono text-[15px] font-bold text-on-surface">
                {metrics ? fmt1(metrics.accuracy) : "100.0"}
              </strong>
              <span className="tracking-widest">ACC %</span>
            </span>
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-container-highest/70">
              <span
                className="block h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${metrics ? Math.min(100, metrics.progressPct) : 0}%` }}
              />
            </span>
            <span className="tracking-widest">
              {metrics ? Math.round(metrics.progressPct) : 0}%
            </span>
            <span className="hidden items-center gap-1 text-outline sm:flex">
              <kbd className="rounded border border-white/10 bg-surface-container-lowest px-1.5 py-0.5 text-[10px]">
                Ctrl+Shift+F
              </kbd>
              <span>exit Zen</span>
            </span>
          </div>
        )}

        {/* Code buffer */}
        {engineState !== null ? (
          <CodeBuffer
            lesson={lesson}
            engineState={engineState}
            running={running}
            bestWpm={lesson ? progress[lesson.id]?.bestWpm ?? 0 : 0}
            zen={zen}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest shadow-2xl">
            <span className="material-symbols-outlined text-[36px] text-outline">keyboard</span>
            <p className="mt-2 font-headline-md text-headline-md text-on-surface">
              No lesson loaded
            </p>
            <p className="mt-1 max-w-sm text-center font-body-sm text-body-sm text-on-surface-variant">
              Pick an available lesson from the sidebar (or the Lessons
              screen) to start a typing session.
            </p>
          </div>
        )}

        {/* Keyboard visualization + status strip — §4.1.3: in Zen Mode it
            collapses smoothly to zero height instead of vanishing. */}
        <div
          inert={zen}
          className={cn(
            "grid shrink-0 transition-all duration-300 ease-out",
            zen ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
          )}
        >
          <div className="flex min-h-0 select-none flex-col gap-2 overflow-hidden rounded-xl border border-surface-container-highest/40 bg-surface-container-low/95 p-3 shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 font-label-sm text-label-sm">
              <span className="flex items-center gap-2 font-semibold text-primary">
                <span className="material-symbols-outlined text-[16px] text-primary-container">keyboard</span>
                <span>Keyboard Guide</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-on-surface-variant">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary-container" />
                  <span>
                    Next key:{" "}
                    {Array.from(upcoming).map((char, i) => (
                      <strong key={i} className="font-mono text-primary">
                        [{char === "\n" ? "\\n" : char}]
                        {i < upcoming.length - 1 ? " " : ""}
                      </strong>
                    ))}
                  </span>
                </span>
                {nextFinger !== null && (
                  <span className="hidden items-center gap-1 text-outline sm:flex">
                    <span className="material-symbols-outlined text-[14px] text-primary">pan_tool</span>
                    <span>
                      {nextFinger.label}
                      {nextTarget?.requiresShift === true ? " + Shift" : ""}
                    </span>
                  </span>
                )}
                {/* §14 compact heatmap toggle — weak keys during practice. */}
                <button
                  type="button"
                  onClick={() => setHeatmapVisible((v) => !v)}
                  aria-pressed={heatmapVisible}
                  aria-label="Toggle 30-day key accuracy heatmap"
                  className={cn(
                    "ml-3 flex items-center gap-1 rounded border px-2 py-0.5 transition-colors",
                    heatmapVisible
                      ? "border-primary-container/50 bg-primary-container/20 font-bold text-primary"
                      : "border-surface-container-highest/60 bg-surface-container-lowest text-outline hover:text-on-surface",
                  )}
                  title="Toggle key heatmap (H outside a run, Ctrl+Shift+H anytime)"
                >
                  <span className="material-symbols-outlined text-[12px]">grid_on</span>
                  <span>Heatmap</span>
                </button>
              </span>
            </div>
            {heatmapVisible && (
              <div className="rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest/60 p-2">
                <p className="mb-1 text-center font-label-sm text-label-sm text-outline">
                  Key heatmap: 30-day accuracy (weak keys highlighted)
                </p>
                <KeyHeatmapCompact data={heatmapData} />
              </div>
            )}
            <KeyboardVisualization
              nextChar={nextCharValue}
              highlightNextKey={highlightNextKey}
              fingerGuides={fingerGuides}
            />
          </div>
        </div>

        {/* Session finished overlay (minimal inline summary — full Results
            screen arrives in Phase 4) */}
        {phase === "finished" && summary !== null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-surface/85 backdrop-blur-sm">
            <div className="w-96 rounded-xl border border-primary-container/40 bg-surface-container-low p-space-lg shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-headline-md text-headline-md text-on-surface">Lesson Complete</h3>
                {persistError === null ? (
                  <span className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-0.5 font-code-sm text-code-sm font-bold text-primary">
                    <span className="material-symbols-outlined text-[14px] text-primary">check_circle</span>
                    Saved to history
                  </span>
                ) : (
                  <span className="rounded bg-error-container px-2 py-0.5 font-code-sm text-code-sm font-bold text-error">
                    Save failed
                  </span>
                )}
              </div>
              <div className="mb-4 grid grid-cols-2 gap-space-sm font-code-md text-code-md">
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">WPM</div>
                  <div className="font-headline-lg text-headline-lg font-bold text-primary">
                    {fmt1(summary.wpm)}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-label-sm text-label-sm text-on-surface-variant">Accuracy</div>
                  <div className="font-headline-lg text-headline-lg font-bold text-on-surface">
                    {fmt1(summary.accuracy)}%
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-label-sm text-label-sm text-on-surface-variant">Duration</div>
                  <div className="font-code-lg text-code-lg font-semibold text-on-surface">
                    {fmtClock(summary.durationMs)}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">Errors / Fix-ups</div>
                  <div className="font-code-lg text-code-lg font-semibold text-on-surface">
                    {summary.errorCount} / {summary.backspaceCount}
                  </div>
                </div>
              </div>
              {persistError !== null && (
                <button
                  type="button"
                  onClick={() => void retryPersist()}
                  className="mb-2 w-full rounded-lg border border-error/40 bg-error-container/40 px-space-sm py-2 font-label-md text-label-md text-error hover:bg-error-container/60"
                >
                  Retry save
                </button>
              )}
              <button
                type="button"
                onClick={() => lesson && void startLesson(lesson)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-container py-2 font-label-md text-label-md font-bold text-on-primary-container shadow-md transition-all hover:bg-tertiary-container"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Retry Lesson</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
