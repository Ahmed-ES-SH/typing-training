import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CURRICULUM_LEVELS,
  TOTAL_LESSONS,
  getLesson,
  type CurriculumLevel,
} from "../content";
import { attemptsRepo, keyStatsRepo } from "../lib/db/repositories";
import { ACCURACY_GATE } from "../lib/curriculum/rules";
import {
  SYMBOL_CHIPS,
  averageLevelStats,
  firstAvailableLessonInLevel,
  matchesAnySymbolChip,
  milestoneAckKey,
  nextMilestoneToCelebrate,
  pendingMilestoneLevels,
  summarizeLevel,
  type SymbolChipId,
} from "../lib/curriculum/frontierNav";
import { fmt1, moduleNumber } from "../lib/format";
import type { KeyStatRow, Lesson, LessonProgress } from "../lib/schemas";
import { cn } from "../lib/cn";
import { FrontierHud } from "../components/FrontierHud";
import { LevelMiniMap, type MiniMapEntry } from "../components/LevelMiniMap";
import { LevelMilestoneModal } from "../components/LevelMilestoneModal";
import { StatusPill } from "../components/StatusPill";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUiStore } from "../stores/useUiStore";
import {
  currentLesson,
  lessonStatus,
  useCurriculumStore,
} from "../stores/useCurriculumStore";

/**
 * Lessons screen — implemented from `screens/all_lessons_typekernel/code.html`
 * (design `code.html` + `screen.png`): hero banner with mastery gauge,
 * search + status filter control bar, expandable level sections with module
 * cards, and the symbol latency telemetry strip.
 *
 * Phase 3 (UX plan §6.1–§6.4) adds the frontier layer on top of that static
 * design: the sticky Resume-Frontier HUD, the L1..L7 mini-map jump rail, the
 * instant syntax/symbol chip bar and the level milestone modal. Every rule
 * behind them lives in `lib/curriculum/frontierNav.ts` (unit-tested); this
 * screen only wires state, refs and the keyboard guards (§4.1.4).
 *
 * All displayed progress data comes from `lesson_progress` / attempts
 * aggregates — the DB is the only source of truth (PRD §7 trust). When the
 * DB is unavailable (e.g. plain-browser preview) the skeleton still renders
 * with a visible error banner and locked states.
 */

type StatusFilter = "all" | "completed" | "active" | "available" | "locked";
type ViewMode = "grid" | "list";

/** Status groups for the filter pills — "active" = frontier in progress. */
function statusOf(
  progress: LessonProgress | undefined,
): "completed" | "active" | "available" | "locked" {
  if (!progress) return "locked";
  if (progress.status === "completed") return "completed";
  if (progress.status === "available") {
    return progress.attemptCount > 0 ? "active" : "available";
  }
  return "locked";
}

/* Number rendering comes from the shared `lib/format` util (Phase 8 §3.5). */

const LEVEL_ICONS: Record<number, string> = {
  1: "keyboard",
  2: "pin",
  3: "code",
  4: "text_fields",
  5: "menu_book",
  6: "data_object",
  7: "terminal",
};

/** Stable DOM id of a level's section wrapper — the header's `aria-controls`. */
function levelSectionId(level: number): string {
  return `level-section-${level}`;
}

/* ---------------------------------------------------------------------------
 * Hero banner
 * ------------------------------------------------------------------------- */

function MasteryGauge({
  completed,
  total,
  activeLevel,
}: {
  completed: number;
  total: number;
  activeLevel: number | null;
}) {
  const pct = total === 0 ? 0 : (completed / total) * 100;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex shrink-0 items-center gap-space-base rounded-xl bg-surface-container p-space-base shadow-md">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
          <circle
            className="text-surface-container-highest"
            cx="50" cy="50" fill="transparent" r="42"
            stroke="currentColor" strokeWidth="8"
          />
          <circle
            className="text-primary-container transition-all duration-1000 ease-out"
            cx="50" cy="50" fill="transparent" r="42"
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth="8"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-headline-md text-headline-md leading-none text-on-surface">
            {fmt1(pct)}%
          </span>
          <span className="mt-1 text-[10px] font-medium text-on-surface-variant">
            Overall
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-primary">
          {activeLevel !== null
            ? `Level ${activeLevel} in progress`
            : completed === total
              ? "Curriculum cleared"
              : "No progress yet"}
        </span>
        <span className="mt-0.5 font-body-md font-medium text-on-surface">
          {completed} / {total} Mastered
        </span>
        <span className="mt-1 font-body-sm text-on-surface-variant">
          {Math.max(0, total - completed)} lessons remaining
        </span>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
          <div
            className="h-full rounded-full bg-primary-container"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function HeroBanner({
  completed,
  activeLevel,
  rollingWpm,
  rollingAccuracy,
  focusLabel,
}: {
  completed: number;
  activeLevel: number | null;
  rollingWpm: string | null;
  rollingAccuracy: string | null;
  focusLabel: string;
}) {
  return (
    <div className="relative mb-space-lg w-full overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-80 w-80 rounded-full bg-primary-container/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-64 w-64 rounded-full bg-primary/5 blur-2xl" />
      <div className="relative z-10 flex flex-col justify-between gap-space-lg lg:flex-row lg:items-center">
        <div className="max-w-2xl">
          <div className="mb-space-xs flex items-center gap-space-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-surface-container-high px-2.5 py-0.5 text-xs font-medium text-primary">
              Complete curriculum
            </span>
            <span className="text-xs text-on-surface-variant">
              • {TOTAL_LESSONS} lessons
            </span>
          </div>
          <h1 className="font-display-lg text-display-lg tracking-tight text-on-surface">
            Curriculum
          </h1>
          <p className="mt-space-xs max-w-xl font-body-md text-body-md text-on-surface-variant">
            Master {TOTAL_LESSONS} lessons from home-row basics to full-code
            fluency — build speed and accuracy one level at a time.
          </p>
          <div className="mt-space-base flex flex-wrap items-center gap-space-md">
            <div className="flex items-center gap-space-xs rounded bg-surface-container px-space-sm py-space-xs">
              <span className="material-symbols-outlined text-[18px] text-primary">speed</span>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-on-surface-variant">
                  Rolling Speed
                </span>
                <span className="font-code-sm font-semibold text-code-sm text-on-surface">
                  {rollingWpm ?? "—"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-space-xs rounded bg-surface-container px-space-sm py-space-xs">
              <span className="material-symbols-outlined text-[18px] text-secondary">verified</span>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-on-surface-variant">
                  Code Accuracy
                </span>
                <span className="font-code-sm font-semibold text-code-sm text-on-surface">
                  {rollingAccuracy ?? "—"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-space-xs rounded bg-surface-container px-space-sm py-space-xs">
              <span className="material-symbols-outlined text-[18px] text-primary-container">radar</span>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-on-surface-variant">
                  Target Focus
                </span>
                <span className="font-code-sm font-medium text-primary">{focusLabel}</span>
              </div>
            </div>
          </div>
        </div>
        <MasteryGauge completed={completed} total={TOTAL_LESSONS} activeLevel={activeLevel} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Module cards
 * ------------------------------------------------------------------------- */

function CodePreview({ lesson, locked }: { lesson: Lesson; locked: boolean }) {
  const firstLine = lesson.content.split("\n")[0].slice(0, 48);
  return (
    <div
      className={cn(
        "my-space-sm overflow-x-auto rounded p-space-xs font-code-sm text-code-sm",
        locked
          ? "select-none bg-surface-container-lowest text-on-surface-variant/40 blur-[1.5px]"
          : "bg-surface-container-low text-primary/80",
      )}
    >
      <code>{firstLine}</code>
    </div>
  );
}

/**
 * Lesson card — memoized so filter/search keystrokes on the screen never
 * re-render the 260 cards (props are stable: lesson, progress row, viewMode).
 */
const ModuleCard = memo(function ModuleCard({
  lesson,
  progress,
  viewMode,
}: {
  lesson: Lesson;
  progress: LessonProgress | undefined;
  viewMode: ViewMode;
}) {
  const startLesson = useCurriculumStore((s) => s.startLesson);
  const status = statusOf(progress);
  const moduleNo = moduleNumber(lesson.level, lesson.orderIndex);

  const header = (
    <div className="mb-space-xs flex items-center justify-between">
      <span
        className={cn(
          "font-code-sm text-code-sm",
          status === "active"
            ? "font-bold text-primary"
            : status === "locked"
              ? "text-on-surface-variant/60"
              : "text-on-surface-variant",
        )}
      >
        Lesson {moduleNo}
      </span>
      {status === "completed" && (
        <StatusPill tone="mastered">
          <span className="material-symbols-outlined text-[12px]">check_circle</span> Mastered
        </StatusPill>
      )}
      {status === "active" && (
        <StatusPill tone="inProgress">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" /> In progress
        </StatusPill>
      )}
      {status === "available" && (
        <StatusPill tone="available">
          <span className="material-symbols-outlined text-[12px]">lock_open</span> Ready
        </StatusPill>
      )}
      {status === "locked" && (
        <StatusPill tone="locked">
          <span className="material-symbols-outlined text-[12px]">lock</span> Locked
        </StatusPill>
      )}
    </div>
  );

  const title = (
    <h4
      className={cn(
        "font-headline-md text-headline-md transition-colors",
        status === "locked" ? "text-on-surface-variant" : "text-on-surface",
      )}
    >
      {lesson.title}
    </h4>
  );

  const description = (
    <p
      className={cn(
        "mt-1 font-body-sm text-body-sm line-clamp-2",
        status === "locked" ? "text-on-surface-variant/70" : "text-on-surface-variant",
      )}
    >
      {lesson.description}
    </p>
  );

  const preview = <CodePreview lesson={lesson} locked={status === "locked"} />;

  const footer = (
    <div>
      {status === "completed" && progress && (
        <div className="flex items-center justify-between py-space-xs font-code-sm text-code-sm text-on-surface-variant">
          <span>
            Best: <strong className="text-on-surface">{fmt1(progress.bestWpm)} WPM</strong>
          </span>
          <span>
            Accuracy: <strong className="text-secondary">{fmt1(progress.bestAccuracy)}%</strong>
          </span>
        </div>
      )}
      {status === "active" && (
        <div className="mb-space-xs flex items-center justify-between rounded bg-surface-container-low px-2 py-space-xs font-code-sm text-code-sm text-on-surface-variant">
          <span>
            {progress && progress.attemptCount > 0 ? "Best: " : "First attempt: "}
            <strong className="text-on-surface">
              {progress && progress.bestWpm > 0 ? `${fmt1(progress.bestWpm)} WPM` : "—"}
            </strong>
          </span>
          <span className={progress && progress.bestAccuracy >= ACCURACY_GATE ? "text-secondary" : "text-error"}>
            {progress && progress.attemptCount > 0
              ? `${fmt1(progress.bestAccuracy)}% accuracy${progress.bestAccuracy >= ACCURACY_GATE ? "" : ` (needs ${ACCURACY_GATE}%)`}`
              : `0.0% accuracy (needs ${ACCURACY_GATE}%)`}
          </span>
        </div>
      )}
      {status === "available" && (
        <div className="py-space-xs text-center font-code-sm text-code-sm text-on-surface-variant">
          <span>
            Target: <strong className="text-primary">&gt; 45 WPM</strong> • Pass accuracy:{" "}
            <strong className="text-primary">{ACCURACY_GATE}.0%</strong>
          </span>
        </div>
      )}
      {status === "locked" && (
        <div className="py-space-xs text-center font-code-sm text-code-sm text-on-surface-variant/70">
          Requires &gt;= {ACCURACY_GATE}% accuracy on the previous lesson
        </div>
      )}
      {status === "locked" ? (
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center justify-center gap-space-xs rounded-lg bg-surface-container-low py-2 font-label-md text-label-md text-on-surface-variant/40"
        >
          <span className="material-symbols-outlined text-[16px]">lock</span>
          <span>Locked</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => startLesson(lesson.id)}
          className={cn(
            "flex w-full items-center justify-center gap-space-xs rounded-lg py-2 font-label-md text-label-md transition-all",
            status === "active"
              ? "bg-primary-container py-2.5 font-bold text-on-primary-container shadow-md hover:bg-tertiary-container"
              : "bg-surface-container-high text-on-surface hover:bg-primary-container hover:text-on-primary-container",
          )}
        >
          <span className="material-symbols-outlined text-[16px]">
            {status === "completed" ? "replay" : status === "active" ? "play_arrow" : "start"}
          </span>
          <span>
            {status === "completed"
              ? "Replay Lesson"
              : status === "active"
                ? `Resume ${moduleNo}`
                : "Start Lesson"}
          </span>
        </button>
      )}
    </div>
  );

  if (viewMode === "list") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-space-base rounded-lg p-space-sm",
          status === "locked"
            ? "bg-surface-container-lowest/50 opacity-70"
            : "bg-surface-container-lowest hover:bg-surface-container",
        )}
      >
        <div className="min-w-0 flex-1">
          {header}
          {title}
          {description}
        </div>
        <div className="hidden w-96 shrink-0 md:block">{preview}</div>
        <div className="w-64 shrink-0">{footer}</div>
      </div>
    );
  }

  const activeHighlight = status === "active";
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-lg p-space-base transition-all",
        activeHighlight
          ? "overflow-hidden bg-surface-container shadow-md"
          : status === "locked"
            ? "bg-surface-container-lowest/60 opacity-75 backdrop-blur-sm"
            : "group bg-surface-container-lowest shadow-sm hover:bg-surface-container",
      )}
    >
      {activeHighlight && (
        <div className="absolute inset-x-0 top-0 h-1 rounded-t bg-primary-container/80" />
      )}
      <div>
        {header}
        {title}
        {description}
        {preview}
      </div>
      {footer}
    </div>
  );
});

/* ---------------------------------------------------------------------------
 * Level sections
 * ------------------------------------------------------------------------- */

function LevelHeader({
  level,
  progress,
  completedCount,
  expanded,
  onToggle,
}: {
  level: CurriculumLevel;
  progress: Record<string, LessonProgress>;
  completedCount: number;
  expanded: boolean;
  onToggle: (level: number) => void;
}) {
  const total = level.lessons.length;
  const isComplete = completedCount === total;
  const isUntouched = completedCount === 0;
  const isActive = !isComplete && !isUntouched;

  // Average best stats over attempted lessons (DB truth, not invented) —
  // the same pure helper the §6.4 milestone modal reads, so the numbers can
  // never drift apart between the two surfaces.
  const stats = averageLevelStats(level.level, progress);
  const avgWpm = stats?.wpm ?? null;
  const avgAcc = stats?.accuracy ?? null;

  return (
    <div
      className={cn(
        "relative flex w-full flex-col justify-between gap-space-sm rounded-xl p-space-base text-left transition-all sm:flex-row sm:items-center",
        isActive
          ? "overflow-hidden bg-surface-container shadow-2xl"
          : isUntouched
            ? "bg-surface-container-lowest/50 opacity-60"
            : "bg-surface-container-lowest hover:bg-surface-container-low",
      )}
    >
      {isActive && expanded && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 h-1 rounded-t bg-primary-container/80" />
      )}
      {/* The <h3> may not live inside a <button> (invalid content model), so
          the card itself is a plain container and a full-bleed transparent
          overlay keeps the whole header clickable while carrying the
          disclosure semantics (aria-expanded / aria-controls). */}
      <button
        type="button"
        onClick={() => onToggle(level.level)}
        aria-expanded={expanded}
        aria-controls={levelSectionId(level.level)}
        aria-label={
          expanded
            ? `Collapse level ${level.level} — ${level.name}`
            : `Expand level ${level.level} — ${level.name}`
        }
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container"
      />
      <div className="flex items-center gap-space-base">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            isComplete
              ? "bg-secondary-container/20 text-secondary"
              : isUntouched
                ? "bg-surface-container text-on-surface-variant"
                : "bg-primary-container/20 text-primary-container",
          )}
        >
          <span className="material-symbols-outlined text-[24px]">
            {isComplete ? "verified" : isUntouched ? "lock" : LEVEL_ICONS[level.level]}
          </span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-space-xs">
            <span
              className={cn(
                "text-xs font-semibold",
                isActive ? "text-primary" : isComplete ? "text-secondary" : "text-on-surface-variant",
              )}
            >
              Level {level.level} • {level.tagline}
            </span>
            <StatusPill
              tone={isComplete ? "mastered" : isActive ? "inProgress" : "locked"}
            >
              {isComplete
                ? "100% complete"
                : isActive
                  ? `${completedCount} of ${total} mastered`
                  : `Locked (0/${total})`}
            </StatusPill>
            {isComplete && (
              /* UX plan §6.2 — the golden badge with the level's tier label. */
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                <span className="material-symbols-outlined text-[13px]">
                  emoji_events
                </span>
                Level Complete
                {level.tagline !== "" ? ` · ${level.tagline}` : ""}
              </span>
            )}
          </div>
          <h3
            className={cn(
              "font-headline-md text-headline-md",
              isUntouched ? "text-on-surface-variant" : "text-on-surface",
            )}
          >
            {level.name}
          </h3>
        </div>
      </div>
      <div className="flex items-center gap-space-lg">
        <div className="flex items-center gap-space-md font-code-sm text-code-sm">
          <div className="text-right">
            <span className="block text-on-surface-variant">Speed</span>
            <span className="font-semibold text-on-surface">
              {avgWpm !== null ? `${fmt1(avgWpm)} WPM` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">Accuracy</span>
            <span className="font-semibold text-on-surface">
              {avgAcc !== null ? `${fmt1(avgAcc)}%` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">Lessons</span>
            <span className={cn("font-semibold", completedCount > 0 ? "text-primary" : "text-on-surface")}>
              {completedCount} / {total}
            </span>
          </div>
        </div>
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </div>
    </div>
  );
}

/**
 * One expandable level — memoized so a search keystroke (which force-expands
 * every section) re-renders the header only when its own props change.
 */
const LevelSection = memo(function LevelSection({
  level,
  progress,
  expanded,
  onToggle,
  viewMode,
  sectionRef,
}: {
  level: CurriculumLevel;
  progress: Record<string, LessonProgress>;
  expanded: boolean;
  onToggle: (level: number) => void;
  viewMode: ViewMode;
  /** §6.2 jump anchor — the mini-map scrolls this wrapper into view. */
  sectionRef?: (element: HTMLDivElement | null) => void;
}) {
  const completedCount = level.lessons.filter(
    (lesson) => lessonStatus(progress, lesson.id) === "completed",
  ).length;
  const isActive = level.lessons.some(
    (lesson) => lessonStatus(progress, lesson.id) === "available",
  );

  return (
    <div id={levelSectionId(level.level)} ref={sectionRef} className="flex flex-col scroll-mt-2">
      <LevelHeader
        level={level}
        progress={progress}
        completedCount={completedCount}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div
          className={cn(
            "rounded-b-xl px-space-base pb-space-base",
            isActive ? "bg-surface-container-low shadow-2xl" : "bg-surface-container-lowest/50",
          )}
        >
          {isActive && (
            <div className="mb-space-base flex items-center gap-space-sm rounded-lg bg-surface-container p-space-sm font-code-sm text-code-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px] text-primary">verified_user</span>
              <span className="font-medium text-on-surface">Unlock requirements:</span>
              <span>
                Must sustain <span className="font-bold text-primary">&gt;= {ACCURACY_GATE}% Accuracy</span> &amp;{" "}
                <span className="font-bold text-primary">&gt; 45 WPM</span> in the same attempt to
                unlock subsequent lessons.
              </span>
            </div>
          )}
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 gap-space-base md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                : "flex flex-col gap-space-xs",
            )}
          >
            {level.lessons.map((lesson) => (
              <ModuleCard
                key={lesson.id}
                lesson={lesson}
                progress={progress[lesson.id]}
                viewMode={viewMode}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/* ---------------------------------------------------------------------------
 * Symbol latency telemetry
 * ------------------------------------------------------------------------- */

const FOCUS_SYMBOLS = [
  "-", ">", ":", "&", "=", "(", ")", "{", "}", "[", "]", ";", "_", "*", "/", "!", "?",
];

/**
 * Symbol latency strip — memoized (and the chip ranking memoized) so the
 * screen's search keystrokes never re-run the filter/sort over `keyStats`.
 */
const SymbolTelemetry = memo(function SymbolTelemetry({ keys }: { keys: KeyStatRow[] }) {
  // Only programming-symbol chips, ranked by volume; hidden entirely when
  // there is not enough data (graceful empty state per the plan).
  const chips = useMemo(
    () =>
      keys
        .filter((row) => FOCUS_SYMBOLS.includes(row.key) && row.totalPresses >= 5)
        .sort((a, b) => b.totalPresses - a.totalPresses)
        .slice(0, 7),
    [keys],
  );

  if (chips.length === 0) return null;

  const maxLatency = Math.max(...chips.map((c) => c.avgLatencyMs), 1);

  return (
    <div className="rounded-xl bg-surface-container-low p-space-base shadow-xl">
      <div className="mb-space-base flex flex-col justify-between gap-space-sm md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[18px] text-primary">query_stats</span>
            <h3 className="font-headline-md text-headline-md text-on-surface">
              Symbol Latency
            </h3>
          </div>
          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
            Average response time for common programming symbols. Pauses over
            &gt;180ms show where you slow down.
          </p>
        </div>
        <div className="flex items-center gap-space-base font-code-sm text-code-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-secondary" />
            <span className="text-on-surface-variant">Fast (&lt;100ms)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="text-on-surface-variant">Steady (100–180ms)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary-container" />
            <span className="text-on-surface-variant">Slow (&gt;180ms)</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4 lg:grid-cols-7">
        {chips.map((chip) => {
          const latency = Math.round(chip.avgLatencyMs);
          const heightPct = Math.max(12, Math.round((chip.avgLatencyMs / maxLatency) * 100));
          const tone =
            latency > 180
              ? { bar: "bg-primary-container", label: "text-error", tag: "Slow" }
              : latency >= 100
                ? { bar: "bg-primary", label: "text-on-surface-variant", tag: "Steady" }
                : { bar: "bg-secondary", label: "text-secondary", tag: "Fast" };
          return (
            <div
              key={`${chip.key}-${chip.shiftRequired ? "s" : "b"}`}
              className="flex flex-col items-center rounded-lg bg-surface-container p-space-sm"
            >
              <span className="mb-2 font-code-lg font-bold text-code-lg text-primary">
                {chip.key}
              </span>
              <div className="flex h-28 w-full items-end justify-center rounded bg-surface-container-lowest p-1">
                <div className={cn("w-6 rounded-t", tone.bar)} style={{ height: `${heightPct}%` }} />
              </div>
              <span className="mt-2 font-code-sm font-semibold text-code-sm text-on-surface">
                {latency}ms
              </span>
              <span className={cn("font-code-sm text-[10px]", tone.label)}>{tone.tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ---------------------------------------------------------------------------
 * Screen
 * ------------------------------------------------------------------------- */

function matchesQuery(lesson: Lesson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    lesson.title.toLowerCase().includes(q) ||
    lesson.description.toLowerCase().includes(q) ||
    lesson.content.toLowerCase().includes(q) ||
    lesson.tags.some((tag) => tag.toLowerCase().includes(q)) ||
    lesson.targetKeys.some((key) => key.toLowerCase().includes(q))
  );
}

/* ---------------------------------------------------------------------------
 * §6.4 milestone acknowledgements — localStorage IO lives here (the pure
 * "which level do we celebrate" rule is `nextMilestoneToCelebrate` in
 * `lib/curriculum/frontierNav`). One celebration per level FOREVER: the ack
 * must survive an app restart, so a fresh launch with a completed level
 * never re-shows the "Level N Mastered" card. Best-effort: private-mode
 * storage failures only mean the level is celebrated again on the next
 * visit. Keys keep the `typekernel.milestone.L<n>` namespace either way.
 * ------------------------------------------------------------------------- */

function readMilestoneAcks(): Set<string> {
  const acks = new Set<string>();
  try {
    for (const level of CURRICULUM_LEVELS) {
      const key = milestoneAckKey(level.level);
      if (localStorage.getItem(key) !== null) acks.add(key);
    }
  } catch {
    /* storage unavailable */
  }
  return acks;
}

function acknowledgeMilestone(level: number): void {
  try {
    localStorage.setItem(milestoneAckKey(level), "1");
  } catch {
    /* storage unavailable */
  }
}

export default function LessonsScreen() {
  const progress = useCurriculumStore((s) => s.progress);
  const dbError = useCurriculumStore((s) => s.dbError);
  const loaded = useCurriculumStore((s) => s.loaded);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [levelFilter, setLevelFilter] = useState<number | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [manualExpanded, setManualExpanded] = useState<Set<number> | null>(null);
  const [rolling, setRolling] = useState<{ wpm: string; acc: string } | null>(null);
  const [keyStats, setKeyStats] = useState<KeyStatRow[]>([]);
  // §6.3 chip bar (multi-select) and §6.4 milestone modal.
  const [symbolChips, setSymbolChips] = useState<Set<SymbolChipId>>(new Set());
  const [milestone, setMilestone] = useState<number | null>(null);
  // §6.2 jump anchors + §6.1 HUD viewport offset.
  const mainRef = useRef<HTMLElement | null>(null);
  const levelRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [hudLeft, setHudLeft] = useState(0);

  // Active engagement level = first level containing an available lesson.
  const activeLevel = useMemo(() => {
    for (const level of CURRICULUM_LEVELS) {
      if (level.lessons.some((lesson) => lessonStatus(progress, lesson.id) === "available")) {
        return level.level;
      }
    }
    return null;
  }, [progress]);

  // Any query/status/level/chip filter force-expands every section, so a
  // header click would write `manualExpanded` with no visible effect — the
  // toggle is a documented no-op while this is true.
  const searching =
    query.trim() !== "" ||
    statusFilter !== "all" ||
    levelFilter !== "all" ||
    symbolChips.size > 0;

  // Derived, memoized: a fresh Set identity on every render would defeat the
  // `React.memo` wrappers on LevelSection/LevelHeader.
  const expandedLevels = useMemo(
    () => manualExpanded ?? (activeLevel !== null ? new Set([activeLevel]) : new Set([1])),
    [manualExpanded, activeLevel],
  );

  const toggleLevel = useCallback(
    (level: number) => {
      if (searching) return;
      setManualExpanded((prev) => {
        const base = prev ?? (activeLevel !== null ? new Set([activeLevel]) : new Set([1]));
        const next = new Set(base);
        if (next.has(level)) next.delete(level);
        else next.add(level);
        return next;
      });
    },
    [searching, activeLevel],
  );

  /** §6.3 chip toggles — multi-select, OR inside the bar, AND with the rest. */
  const toggleChip = useCallback((chipId: SymbolChipId) => {
    setSymbolChips((prev) => {
      const next = new Set(prev);
      if (next.has(chipId)) next.delete(chipId);
      else next.add(chipId);
      return next;
    });
  }, []);

  /** Empty-state reset — clears query + status + level + chips in one click. */
  const clearFilters = useCallback(() => {
    setQuery("");
    setStatusFilter("all");
    setLevelFilter("all");
    setSymbolChips(new Set());
  }, []);

  // Stable per-level `sectionRef` callbacks: an inline arrow in the render
  // below would be a new prop identity for every section on every keystroke.
  const sectionRefCallbacks = useRef<Record<number, (element: HTMLDivElement | null) => void>>(
    {},
  );
  const sectionRefFor = (level: number): ((element: HTMLDivElement | null) => void) => {
    const existing = sectionRefCallbacks.current[level];
    if (existing !== undefined) return existing;
    const callback = (element: HTMLDivElement | null) => {
      levelRefs.current[level] = element;
    };
    sectionRefCallbacks.current[level] = callback;
    return callback;
  };

  // §6.1: the fixed HUD tracks this screen's own left edge so the collapsible
  // NavSidebar (z-30) never lands on top of the bar — or vice versa. The
  // observer also follows the sidebar's collapse/expand width transition,
  // which fires a ResizeObserver callback per animation frame: coalesce those
  // through a single requestAnimationFrame so one sidebar toggle costs one
  // state update instead of dozens of whole-screen re-renders.
  useLayoutEffect(() => {
    const element = mainRef.current;
    if (element === null) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setHudLeft(element.getBoundingClientRect().left);
      });
    };
    // Measure once synchronously so the bar never paints at `left: 0`; every
    // ResizeObserver tick that follows is coalesced through `schedule`.
    setHudLeft(element.getBoundingClientRect().left);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [loaded]);

  // §6.4 trigger. On mount every level that is 100% complete but never
  // acknowledged is celebrated once (acknowledged immediately, so later
  // visits stay quiet); a 0→100 transition while the screen stays mounted
  // re-runs this effect because the store replaces `progress` wholesale.
  // The freshest completion is shown, the whole pending batch acknowledged —
  // a stale save can never chain back-to-back modals.
  useEffect(() => {
    if (!loaded) return;
    const acks = readMilestoneAcks();
    const celebration = nextMilestoneToCelebrate(acks, progress);
    if (celebration === null) return;
    for (const level of pendingMilestoneLevels(acks, progress)) {
      acknowledgeMilestone(level);
    }
    setMilestone(celebration);
  }, [progress, loaded]);

  /** §6.1 frontier label + level mastery for the sticky HUD. */
  const frontier = useMemo(() => currentLesson(progress), [progress]);
  const frontierMastery = useMemo(
    () => (frontier !== null ? summarizeLevel(frontier.level, progress) : null),
    [frontier, progress],
  );
  const frontierLabel = useMemo(() => {
    if (frontier === null) return null;
    const lesson = getLesson(frontier.id);
    return lesson == null
      ? { moduleNo: `L${frontier.level}`, title: frontier.title }
      : { moduleNo: moduleNumber(lesson.level, lesson.orderIndex), title: lesson.title };
  }, [frontier]);

  /** §6.2 mini-map jump — scroll the level header into view (honouring
   *  `prefers-reduced-motion` rather than always animating). */
  const jumpToLevel = useCallback((level: number) => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    levelRefs.current[level]?.scrollIntoView({ behavior, block: "start" });
  }, []);

  // §6.4 primary action: start the next level's first available lesson, or
  // fall back to scrolling its header into view when nothing is available
  // (DB unavailable → everything reads as locked). Memoized so the milestone
  // modal's window listener does not re-register on every keystroke.
  const advanceToLevel = useCallback(
    (level: number) => {
      const lesson = firstAvailableLessonInLevel(level, progress);
      if (lesson !== null) {
        useCurriculumStore.getState().startLesson(lesson.id);
        return;
      }
      setManualExpanded((prev) => {
        const base = prev ?? (activeLevel !== null ? new Set([activeLevel]) : new Set([1]));
        const next = new Set(base);
        next.add(level);
        return next;
      });
      jumpToLevel(level);
    },
    [progress, activeLevel, jumpToLevel],
  );

  // §6.1/§6.4 — stable callbacks for the HUD + milestone modal. Both own
  // window key listeners whose effect deps include these props, so inline
  // arrows would tear them down and re-register on every keystroke.
  const resumeFrontier = useCallback(() => {
    if (frontier !== null) useCurriculumStore.getState().startLesson(frontier.id);
  }, [frontier]);
  const advanceMilestone = useCallback(() => {
    if (milestone === null) return;
    setMilestone(null);
    advanceToLevel(milestone + 1);
  }, [milestone, advanceToLevel]);
  const reviewWeakKeys = useCallback(() => {
    setMilestone(null);
    useUiStore.getState().navigate("weakness-training");
  }, []);
  const closeMilestone = useCallback(() => setMilestone(null), []);

  // Counts over the whole curriculum for the filter pills.
  const counts = useMemo(() => {
    const tally = { all: TOTAL_LESSONS, completed: 0, active: 0, available: 0, locked: 0 };
    for (const lesson of CURRICULUM_LEVELS.flatMap((l) => l.lessons)) {
      tally[statusOf(progress[lesson.id])]++;
    }
    return tally;
  }, [progress]);

  const showTelemetryStrip = useSettingsStore((s) => s.settings.showTelemetryStrip);

  // Rolling stats + key telemetry, best-effort (hidden when DB unavailable).
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [recent, keys] = await Promise.all([
          attemptsRepo.recent(10),
          keyStatsRepo.all(),
        ]);
        if (cancelled) return;
        if (recent.length > 0) {
          const wpm = recent.reduce((s, a) => s + a.wpm, 0) / recent.length;
          const acc = recent.reduce((s, a) => s + a.accuracy, 0) / recent.length;
          setRolling({ wpm: `${fmt1(wpm)} WPM`, acc: `${fmt1(acc)}%` });
        } else {
          setRolling(null);
        }
        setKeyStats(keys);
      } catch {
        if (!cancelled) {
          setRolling(null);
          setKeyStats([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, progress]);

  // UX plan §5.1: Ctrl+K now belongs to the global Command Palette, which
  // searches this screen's lessons (and more) — the old local "focus search"
  // binding would have double-fired next to it.

  // Hero gauge + focus label.
  const gauge = useMemo(() => {
    let completed = 0;
    let nextAvailableId: string | null = null;
    for (const lesson of CURRICULUM_LEVELS.flatMap((l) => l.lessons)) {
      const status = lessonStatus(progress, lesson.id);
      if (status === "completed") completed += 1;
      if (status === "available" && nextAvailableId === null) nextAvailableId = lesson.id;
    }
    return { completed, nextAvailableId };
  }, [progress]);

  const focusLabel = useMemo(() => {
    if (gauge.nextAvailableId === null) {
      // No progress data (fresh DB error or cleared curriculum): point at the
      // curriculum start rather than an empty label.
      return dbError !== null
        ? "Level 1: Home Row & Core Alphanumerics"
        : "Curriculum Cleared";
    }
    const lesson = CURRICULUM_LEVELS.flatMap((l) => l.lessons).find(
      (l) => l.id === gauge.nextAvailableId,
    );
    const meta = CURRICULUM_LEVELS.find((l) => l.level === lesson?.level);
    return lesson && meta ? `Level ${meta.level}: ${meta.name}` : "—";
  }, [gauge.nextAvailableId, dbError]);

  // Filtering pipeline: search -> syntax chips -> status pill -> level dropdown.
  const visibleLevels = useMemo(() => {
    return CURRICULUM_LEVELS.map((level) => ({
      level,
      lessons: level.lessons.filter((lesson) => {
        if (!matchesQuery(lesson, query)) return false;
        if (!matchesAnySymbolChip(lesson, symbolChips)) return false;
        if (statusFilter !== "all" && statusOf(progress[lesson.id]) !== statusFilter) return false;
        if (levelFilter !== "all" && level.level !== levelFilter) return false;
        return true;
      }),
    })).filter((entry) => entry.lessons.length > 0);
  }, [query, symbolChips, statusFilter, levelFilter, progress]);

  // §6.2 mini-map: completion per level + which entries the filters removed.
  const miniMapEntries: MiniMapEntry[] = useMemo(() => {
    const visible = new Set(visibleLevels.map((entry) => entry.level.level));
    return CURRICULUM_LEVELS.map((level) => {
      const mastery = summarizeLevel(level.level, progress);
      return {
        level: mastery.level,
        name: mastery.name,
        tier: mastery.tier,
        completed: mastery.completed,
        total: mastery.total,
        pct: mastery.pct,
        complete: mastery.complete,
        current: activeLevel === level.level,
        visible: visible.has(level.level),
      };
    });
  }, [progress, visibleLevels, activeLevel]);

  if (!loaded) {
    return (
      <main className="flex w-full flex-1 items-center justify-center bg-surface">
        <span className="font-code-md text-code-md text-on-surface-variant">
          Loading curriculum…
        </span>
      </main>
    );
  }

  return (
    <main
      ref={mainRef}
      className="w-full flex-1 overflow-y-auto bg-surface px-gutter-desktop pb-28 pt-4"
    >
      {/* `xl:pr-16` keeps the last cards clear of the §6.2 fixed jump rail. */}
      <div className="flex w-full flex-col xl:pr-16">
        <HeroBanner
          completed={gauge.completed}
          activeLevel={activeLevel}
          rollingWpm={rolling?.wpm ?? null}
          rollingAccuracy={rolling?.acc ?? null}
          focusLabel={focusLabel}
        />

        {dbError !== null && (
          <div className="mb-space-base flex items-center gap-2 rounded-lg border border-error/40 bg-error-container/30 px-space-sm py-2 font-code-sm text-code-sm text-error">
            <span className="material-symbols-outlined text-[14px]">error</span>
            <span>Progress unavailable: {dbError} — lesson states shown as locked.</span>
          </div>
        )}

        {/* Control bar */}
        <div className="mb-space-base flex flex-col items-stretch justify-between gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm shadow-sm lg:flex-row lg:items-center">
          <div className="relative min-w-[280px] flex-1">
            <span className="material-symbols-outlined absolute left-space-sm top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search lessons"
              placeholder="Search by token, symbol, concept, or language (e.g., pointers, ::, regex, json)..."
              className="w-full rounded-lg bg-surface-container-low py-2 pl-10 pr-space-base font-code-md text-code-md text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:bg-surface-container focus:outline-none focus:ring-1 focus:ring-primary-container"
            />
            <span className="absolute right-space-sm top-1/2 -translate-y-1/2 rounded bg-surface-container-high px-1.5 py-0.5 font-code-sm text-[10px] uppercase text-on-surface-variant">
              ⌘K
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-space-xs">
            <div className="inline-flex gap-1 rounded-lg bg-surface-container-low p-1">
              {(["all", "completed", "active", "available", "locked"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  aria-pressed={statusFilter === filter}
                  className={cn(
                    "rounded px-space-sm py-1 font-label-sm capitalize text-label-sm transition-all",
                    statusFilter === filter
                      ? "bg-primary-container font-semibold text-on-primary-container"
                      : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                  )}
                >
                  {filter === "all" ? "All" : filter} ({counts[filter]})
                </button>
              ))}
            </div>
            <select
              value={levelFilter}
              onChange={(e) =>
                setLevelFilter(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              aria-label="Filter by level"
              className="rounded-lg bg-surface-container py-2 pl-space-sm pr-space-sm font-label-md text-label-md text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
            >
              <option value="all">All Levels (1-7)</option>
              {CURRICULUM_LEVELS.map((level) => (
                <option key={level.level} value={level.level}>
                  Level {level.level} — {level.name}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-lg bg-surface-container-low p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid View"
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                className={cn(
                  "rounded p-1.5 transition-all",
                  viewMode === "grid"
                    ? "bg-surface-container text-primary shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                <span className="material-symbols-outlined text-[18px]">grid_view</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="Compact List View"
                aria-label="Compact list view"
                aria-pressed={viewMode === "list"}
                className={cn(
                  "rounded p-1.5 transition-all",
                  viewMode === "list"
                    ? "bg-surface-container text-primary shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
              </button>
            </div>
          </div>
        </div>

        {/* §6.3 instant syntax & symbol chip bar — multi-select, OR inside the
            bar, ANDed with the search/status/level filters above. */}
        <div className="mb-space-base flex flex-wrap items-center gap-space-xs rounded-xl bg-surface-container-lowest px-space-sm py-space-sm shadow-sm">
          <span className="flex items-center gap-1.5 pr-space-xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px]">data_object</span>
            Syntax
          </span>
          {SYMBOL_CHIPS.map((chip) => {
            const active = symbolChips.has(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleChip(chip.id)}
                className={cn(
                  "rounded-lg border px-space-sm py-1 font-code-sm text-code-sm transition-all",
                  active
                    ? "border-primary-container/60 bg-primary-container font-bold text-on-primary-container shadow-sm"
                    : "border-surface-container-highest/50 bg-surface-container text-on-surface-variant hover:border-primary-container/40 hover:text-on-surface",
                )}
              >
                {chip.label}
              </button>
            );
          })}
          {symbolChips.size > 0 && (
            <button
              type="button"
              onClick={() => setSymbolChips(new Set())}
              className="flex items-center gap-1 rounded-lg px-space-sm py-1 font-code-sm text-code-sm text-on-surface-variant transition-all hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
              Clear ({symbolChips.size})
            </button>
          )}
        </div>

        {/* Level sections */}
        <div className="mb-space-xl flex flex-col gap-space-base">
          {visibleLevels.length === 0 ? (
            <div className="flex flex-col items-center gap-space-base rounded-xl bg-surface-container-lowest p-space-xl text-center font-code-md text-code-md text-on-surface-variant">
              <span>No lessons match the current search or filters.</span>
              {searching && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex w-fit items-center gap-1 rounded-lg border border-surface-container-highest/50 bg-surface-container px-space-sm py-1 font-code-sm text-code-sm text-on-surface-variant transition-all hover:border-primary-container/40 hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            visibleLevels.map(({ level }) => (
              <LevelSection
                key={level.level}
                level={level}
                progress={progress}
                expanded={searching || expandedLevels.has(level.level)}
                onToggle={toggleLevel}
                viewMode={viewMode}
                sectionRef={sectionRefFor(level.level)}
              />
            ))
          )}
        </div>

        {showTelemetryStrip && <SymbolTelemetry keys={keyStats} />}
      </div>

      {/* §6.2 jump rail — fixed to the right edge, xl and up only. */}
      <LevelMiniMap entries={miniMapEntries} onJump={jumpToLevel} />

      {/* §6.1 sticky Resume-Frontier HUD (hidden while the DB failed — the
          error banner already explains why there is no frontier). */}
      {dbError === null && (
        <FrontierHud
          frontier={frontierLabel}
          mastery={frontierMastery}
          enabled={milestone === null}
          left={hudLeft}
          onResume={resumeFrontier}
        />
      )}

      {/* §6.4 level milestone summary. */}
      {milestone !== null && (
        <LevelMilestoneModal
          mastery={summarizeLevel(milestone, progress)}
          stats={averageLevelStats(milestone, progress)}
          nextLevel={
            CURRICULUM_LEVELS.some((level) => level.level === milestone + 1)
              ? milestone + 1
              : null
          }
          onAdvance={advanceMilestone}
          onReviewWeakKeys={reviewWeakKeys}
          onClose={closeMilestone}
        />
      )}
    </main>
  );
}
