import { useEffect, useMemo, useRef, useState } from "react";

import { lessonsByLevel, getLevelMeta } from "../content";
import { KeyboardVisualization } from "../components/KeyboardVisualization";
import { KeyHeatmapCompact } from "../components/KeyHeatmapCompact";
import { findTargetKey, FINGERS, getActiveLayout } from "../lib/layout";
import { getCharAccuracy, type CharAccuracy } from "../lib/intelligence/heatmap";
import { fmt1, fmtClock, moduleNumber } from "../lib/format";
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
 * Sidebar module states (✓ completed / RUNNING / next / 🔒 locked) come from
 * the real curriculum + `lesson_progress` rows (Phase 4). The lesson is
 * selected through navigation params; finishing routes to the Results screen.
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
      <div className="relative overflow-hidden rounded-lg border border-primary-container/40 bg-surface-container-high p-space-sm shadow-lg ring-1 ring-primary-container/30">
        <div className="absolute bottom-0 left-0 top-0 w-1.5 bg-primary-container shadow-[0_0_12px_rgb(249_115_22_calc(0.9_*_var(--accent-alpha)))]" />
        <div className="mb-1 flex items-center justify-between pl-1">
          <div className="flex items-center gap-space-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-container" />
            </span>
            <span className="font-code-sm text-code-sm font-bold text-primary">
              {num} {lesson.title}
            </span>
          </div>
          <span className="rounded bg-primary-container px-1.5 py-0.5 font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-primary-container">
            RUNNING
          </span>
        </div>
        <div className="flex items-center justify-between pl-3.5 font-code-sm text-code-sm text-on-surface-variant">
          <span className="text-primary-fixed">{tokens}</span>
          {progress && progress.bestWpm > 0 && (
            <span className="font-semibold text-on-surface">PR: {fmt1(progress.bestWpm)} WPM</span>
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
          <span className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-code-sm text-code-sm text-on-surface-variant">
            NEXT
          </span>
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
        <span className="font-label-sm text-label-sm text-outline">LOCKED</span>
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
}: {
  lesson: Lesson | null;
  activeLessonId: string | null;
  progress: Record<string, import("../lib/schemas").LessonProgress>;
  onSelect: (lesson: Lesson) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
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
      className={cn(
        "flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-surface-container-highest/30 bg-surface-container-low shadow-2xl transition-all duration-300 lg:w-88 xl:w-96",
        collapsed ? "hidden" : "",
      )}
    >
      {/* Track header */}
      <div className="relative overflow-hidden border-b border-surface-container-highest/40 bg-gradient-to-b from-surface-container-high/40 to-transparent p-space-base">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary-container/15 blur-2xl" />
        <div className="mb-1.5 flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
          <span className="font-bold tracking-wider text-primary">
            TRACK {String(level).padStart(2, "0")} // LEVEL {String(level).padStart(2, "0")}
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
            {levelLessons.length - completed} Modules Remaining
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-col gap-1.5 border-b border-surface-container-highest/30 bg-surface-container-lowest/40 p-space-xs">
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

function CodeBuffer({ lesson, engineState, running }: {
  lesson: Lesson | null;
  engineState: SessionState;
  running: boolean;
}) {
  const activeLineRef = useRef<HTMLDivElement | null>(null);

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
      {/* Editor sub-header */}
      <div className="flex shrink-0 items-center justify-between border-b border-surface-container-highest/40 bg-surface-container-low px-space-base py-1.5">
        <div className="flex items-center gap-space-sm">
          <div className="flex items-center gap-2 rounded-t-md border-t-2 border-primary-container bg-surface-container-lowest px-space-sm py-1 font-code-sm text-code-sm font-semibold text-primary">
            <span className="material-symbols-outlined text-[15px] text-primary-container">data_object</span>
            <span>{lesson ? `${lesson.id}.txt` : "module.txt"}</span>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
          </div>
          <div className="hidden items-center gap-1 px-2 font-code-sm text-code-sm text-on-surface-variant sm:flex">
            <span>{lesson ? lesson.title : "no module selected"}</span>
          </div>
        </div>
        <div className="flex items-center gap-space-md font-code-sm text-code-sm text-on-surface-variant">
          <span className="hidden rounded bg-surface-container px-2 py-0.5 text-primary-fixed md:inline">
            LEVEL {String(lesson?.level ?? 0).padStart(2, "0")} //{" "}
            {getLevelMeta(lesson?.level ?? 1)?.tagline ?? "IDLE"}
          </span>
          <span className="hidden sm:inline">UTF-8</span>
          <div className="flex items-center gap-1 text-on-surface">
            <span className="material-symbols-outlined text-[14px] text-primary">pin_drop</span>
            <span>
              Ln {activeLine + 1}, Col{" "}
              {Math.max(1, engineState.position - (lines[activeLine]?.offset ?? 0) + 1)}
            </span>
          </div>
        </div>
      </div>

      {/* Buffer body */}
      <div className="relative flex-1 overflow-auto p-space-base font-code-lg text-code-lg leading-loose sm:p-space-lg">
        {lines.map((line, lineIndex) => {
          const isActive = lineIndex === activeLine && running;
          const caretAtLineEnd =
            running && engineState.position === line.offset + line.text.length;
          return (
            <div
              key={lineIndex}
              ref={isActive ? activeLineRef : undefined}
              className={`flex items-center rounded-md ${
                isActive ? "relative -mx-1 bg-surface-container-high/60 px-1 py-1 shadow-inner" : ""
              }`}
            >
              {isActive && (
                <div className="absolute bottom-0 left-0 top-0 w-1.5 rounded-l bg-primary-container shadow-[0_0_12px_rgb(249_115_22_calc(0.8_*_var(--accent-alpha)))]" />
              )}
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

                    const statusClass =
                      entry.status === "correct"
                        ? "text-on-surface"
                        : entry.status === "incorrect"
                          ? "rounded bg-error-container text-on-error-container"
                          : "text-outline opacity-70";

                    return (
                      <span key={globalIndex} className="relative inline-block">
                        {isCurrent && (
                          <span className="absolute -left-0.5 top-1/2 h-5 w-0.5 -translate-y-1/2 animate-pulse bg-primary shadow-[0_0_8px_rgb(249_115_22_calc(1_*_var(--accent-alpha)))]" />
                        )}
                        <span
                          className={
                            isCurrent
                              ? "rounded border border-primary-container/50 bg-primary-container/25 px-0.5 text-primary"
                              : statusClass
                          }
                        >
                          {entry.status === "incorrect" && entry.typed !== null
                            ? entry.typed
                            : expected === " "
                              ? "\u00A0"
                              : expected}
                        </span>
                      </span>
                    );
                  })
                )}
                {caretAtLineEnd && (
                  <span className="ml-0.5 inline-block h-6 w-2.5 animate-pulse bg-primary-container shadow-[0_0_12px_rgb(249_115_22_calc(1_*_var(--accent-alpha)))]" />
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

  // §14 compact heatmap: data loads once on first toggle (never per
  // keystroke), and the toggle itself never steals keystroke focus.
  const [heatmapVisible, setHeatmapVisible] = useState(false);
  const [heatmapData, setHeatmapData] = useState<CharAccuracy[]>([]);
  useEffect(() => {
    if (!heatmapVisible || heatmapData.length > 0) return;
    let cancelled = false;
    void getCharAccuracy("30d").then((data) => {
      if (!cancelled) setHeatmapData(data);
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
  useEffect(() => {
    const lessonId = sessionParams?.lessonId ?? null;
    if (phase === "idle" && lessonId !== null && startedFor.current !== lessonId) {
      void resolveTypingLesson(lessonId).then((selected) => {
        if (selected) {
          startedFor.current = lessonId;
          void startLesson(selected);
        }
      });
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
  // row on unmount — same semantics as the Weakness screen's Esc).
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      useUiStore.getState().navigate("lessons");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  // Global keydown listener — active only while a session is running.
  useEffect(() => {
    if (phase !== "running") return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Modifier combos (Ctrl+C, Ctrl+B, ...) pass through untouched.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        typeChar("\n");
      } else if (event.key === "Tab") {
        // Documented choice: Tab inserts a space (content never has tabs).
        event.preventDefault();
        typeChar(" ");
      } else if (event.key.length === 1) {
        event.preventDefault();
        typeChar(event.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, typeChar, backspace]);

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
    <main className="flex min-h-0 w-full flex-1 gap-space-sm overflow-hidden bg-surface p-space-sm sm:p-space-base">
      <ModuleSidebar
        lesson={lesson}
        activeLessonId={lesson?.id ?? null}
        progress={progress}
        onSelect={(selected) => void startLesson(selected)}
      />

      <section className="relative flex h-full min-w-0 flex-1 flex-col gap-space-sm overflow-hidden">
        {/* Telemetry & controls */}
        <div className="flex shrink-0 flex-col gap-space-sm rounded-xl border border-surface-container-highest/30 bg-surface-container-low p-space-sm shadow-md sm:p-space-base">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <div className="flex flex-wrap items-center gap-space-md sm:gap-space-lg">
              {/* WPM */}
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline-xl text-headline-xl font-bold tracking-tight text-primary">
                  {metrics ? fmt1(metrics.wpm) : "0.0"}
                </span>
                <span className="font-code-sm text-code-sm text-primary">WPM</span>
              </div>
              <div className="h-8 w-px bg-surface-container-highest" />
              {/* Accuracy */}
              <div className="flex items-baseline gap-1">
                <span className="font-headline-xl text-headline-xl font-bold tracking-tight text-on-surface">
                  {metrics ? fmt1(metrics.accuracy) : "100.0"}
                </span>
                <span className="font-code-sm text-code-sm text-on-surface-variant">%</span>
                <span className="font-code-sm text-code-sm text-on-surface-variant">ACC</span>
              </div>
              <div className="hidden h-8 w-px bg-surface-container-highest sm:block" />
              {/* Errors */}
              <div className="flex items-center gap-space-xs">
                <span className="rounded bg-error-container px-2 py-0.5 font-code-sm text-code-sm font-bold text-error">
                  {metrics ? metrics.incorrectChars : 0} ERR
                </span>
                <span className="rounded bg-surface-container px-2 py-0.5 font-code-sm text-code-sm text-on-surface-variant">
                  {metrics ? fmt1(metrics.errorRate) : "0.0"}% RATE
                </span>
              </div>
              <div className="hidden h-8 w-px bg-surface-container-highest md:block" />
              {/* Chars */}
              <div className="flex flex-col">
                <span className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                  Chars
                </span>
                <div className="mt-0.5 flex items-baseline gap-1 font-code-lg text-code-lg font-bold text-secondary">
                  {metrics ? metrics.totalChars : 0}
                  <span className="font-code-sm text-code-sm font-normal text-on-surface-variant">
                    ({metrics ? metrics.correctChars : 0} ok / {metrics ? metrics.incorrectChars : 0} bad)
                  </span>
                </div>
              </div>
              <div className="hidden h-8 w-px bg-surface-container-highest md:block" />
              {/* Fix-ups */}
              <div className="hidden flex-col md:flex">
                <span className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                  Fix-Ups
                </span>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="font-code-lg text-code-lg font-bold text-secondary">
                    {metrics ? metrics.backspaceCount : 0}
                  </span>
                  <span className="font-code-sm text-code-sm text-on-surface-variant">backspaces</span>
                </div>
              </div>
              <div className="h-8 w-px bg-surface-container-highest" />
              {/* Elapsed */}
              <div className="flex items-center gap-1 font-code-lg text-code-lg font-semibold text-on-surface">
                <span className="material-symbols-outlined text-[16px] text-primary">timer</span>
                <span>{metrics ? fmtClock(metrics.elapsedMs) : "00:00"}</span>
              </div>
            </div>

            <div className="flex items-center gap-space-xs">
              <button
                type="button"
                onClick={() => lesson && void startLesson(lesson)}
                className="flex items-center gap-1 rounded-lg border border-surface-container-highest/40 bg-surface-container px-3 py-1.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-high"
                title="Restart Buffer"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Reset</span>
              </button>
            </div>
          </div>

          {persistError !== null && (
            <div className="flex items-center justify-between gap-2 rounded border border-error/40 bg-error-container/40 px-space-sm py-1 font-code-sm text-code-sm text-error">
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">error</span>
                SAVE FAILED: {persistError}
              </span>
              <button
                type="button"
                onClick={() => void retryPersist()}
                className="rounded bg-surface-container px-2 py-0.5 font-bold text-on-surface hover:bg-surface-container-high"
              >
                RETRY SAVE
              </button>
            </div>
          )}

          {/* Buffer progress */}
          <div className="flex flex-col gap-1">
            <div className="relative h-2 w-full overflow-hidden rounded-full border border-surface-container-highest/30 bg-surface-container-lowest">
              <div
                className="h-full rounded-full bg-gradient-to-r from-secondary-container via-primary-container to-primary shadow-[0_0_8px_rgb(249_115_22_calc(0.6_*_var(--accent-alpha)))] transition-all duration-300"
                style={{ width: `${metrics ? Math.min(100, metrics.progressPct) : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
              <span>
                Buffer Progress: {engineState?.position ?? 0} of{" "}
                {engineState?.entries.length ?? 0} chars committed
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-outline">
                  Stream Speed:{" "}
                  {metrics && metrics.elapsedMs > 0
                    ? Math.round((metrics.totalChars / metrics.elapsedMs) * 60_000)
                    : 0}{" "}
                  CPM
                </span>
                <span className="font-bold text-primary">
                  {metrics ? Math.round(metrics.progressPct) : 0}% Finished
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Code buffer */}
        {engineState !== null ? (
          <CodeBuffer lesson={lesson} engineState={engineState} running={running} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest shadow-2xl">
            <span className="material-symbols-outlined text-[36px] text-outline">keyboard</span>
            <p className="mt-2 font-headline-md text-headline-md text-on-surface">
              No module loaded
            </p>
            <p className="mt-1 max-w-sm text-center font-body-sm text-body-sm text-on-surface-variant">
              Pick an available module from the sidebar (or the Lessons
              screen) to start a typing session.
            </p>
          </div>
        )}

        {/* Keyboard visualization + status strip */}
        <div className="flex shrink-0 select-none flex-col gap-2 rounded-xl border border-surface-container-highest/40 bg-surface-container-low/95 p-3 shadow-inner">
          <div className="flex items-center justify-between px-1 font-code-sm text-[11px]">
            <span className="flex items-center gap-2 font-semibold text-primary">
              <span className="material-symbols-outlined text-[14px] text-primary-container">keyboard</span>
              <span>60% MECH PROGRAMMER DECK</span>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
              <span className="h-2 w-2 rounded bg-primary-container shadow-[0_0_8px_rgb(249_115_22_calc(0.8_*_var(--accent-alpha)))]" />
              <span>
                Active Sequence Keys:{" "}
                {Array.from(upcoming).map((char, i) => (
                  <strong key={i} className="text-primary">
                    [{char === "\n" ? "\\n" : char}]
                    {i === 0 && upcoming.length > 1 ? " then " : " "}
                  </strong>
                ))}
              </span>
              {nextFinger !== null && (
                <span className="hidden items-center gap-1 text-outline sm:flex">
                  <span className="material-symbols-outlined text-[12px] text-primary">pan_tool</span>
                  <span>
                    {nextFinger.label}
                    {nextTarget?.requiresShift === true ? " + SHIFT" : ""}
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
                title="Toggle key heatmap (30-day accuracy)"
              >
                <span className="material-symbols-outlined text-[12px]">grid_on</span>
                <span>HEATMAP</span>
              </button>
            </span>
          </div>
          {heatmapVisible && (
            <div className="rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest/60 p-2">
              <p className="mb-1 text-center font-code-sm text-[9px] uppercase tracking-widest text-outline">
                Key Heatmap // 30-Day Accuracy (weak keys highlighted)
              </p>
              <KeyHeatmapCompact data={heatmapData} />
            </div>
          )}
          <KeyboardVisualization
            nextChar={nextCharValue}
            highlightNextKey={useSettingsStore.getState().settings.highlightNextKey}
            fingerGuides={useSettingsStore.getState().settings.fingerGuides}
          />
        </div>

        {/* Session finished overlay (minimal inline summary — full Results
            screen arrives in Phase 4) */}
        {phase === "finished" && summary !== null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-surface/85 backdrop-blur-sm">
            <div className="w-96 rounded-xl border border-primary-container/40 bg-surface-container-low p-space-lg shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-headline-md text-headline-md text-on-surface">SESSION COMPLETE</h3>
                {persistError === null ? (
                  <span className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-0.5 font-code-sm text-code-sm font-bold text-primary">
                    <span className="material-symbols-outlined text-[14px] text-primary">check_circle</span>
                    SAVED
                  </span>
                ) : (
                  <span className="rounded bg-error-container px-2 py-0.5 font-code-sm text-code-sm font-bold text-error">
                    NOT SAVED
                  </span>
                )}
              </div>
              <div className="mb-4 grid grid-cols-2 gap-space-sm font-code-md text-code-md">
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">GROSS WPM</div>
                  <div className="font-headline-lg text-headline-lg font-bold text-primary">
                    {fmt1(summary.wpm)}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">ACCURACY</div>
                  <div className="font-headline-lg text-headline-lg font-bold text-on-surface">
                    {fmt1(summary.accuracy)}%
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">DURATION</div>
                  <div className="font-code-lg text-code-lg font-semibold text-on-surface">
                    {fmtClock(summary.durationMs)}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-container-lowest p-space-sm">
                  <div className="font-code-sm text-code-sm text-on-surface-variant">ERRORS / FIX-UPS</div>
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
                  RETRY SAVE
                </button>
              )}
              <button
                type="button"
                onClick={() => lesson && void startLesson(lesson)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-container py-2 font-label-md text-label-md font-bold text-on-primary-container shadow-[0_0_14px_rgb(249_115_22_calc(0.4_*_var(--accent-alpha)))] transition-all hover:bg-tertiary-container"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>RETRY LESSON</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
