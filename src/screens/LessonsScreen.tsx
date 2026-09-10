import { useEffect, useMemo, useRef, useState } from "react";

import {
  CURRICULUM_LEVELS,
  TOTAL_LESSONS,
  type CurriculumLevel,
} from "../content";
import { attemptsRepo, keyStatsRepo } from "../lib/db/repositories";
import { ACCURACY_GATE } from "../lib/curriculum/rules";
import { fmt1, moduleNumber } from "../lib/format";
import type { KeyStatRow, Lesson, LessonProgress } from "../lib/schemas";
import { cn } from "../lib/cn";
import { useSettingsStore } from "../stores/useSettingsStore";
import { lessonStatus, useCurriculumStore } from "../stores/useCurriculumStore";

/**
 * Lessons screen — implemented from `screens/all_lessons_typekernel/code.html`
 * (design `code.html` + `screen.png`): hero banner with mastery gauge,
 * search + status filter control bar, expandable level sections with module
 * cards, and the symbol latency telemetry strip.
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
          <span className="mt-1 font-code-sm text-[10px] uppercase text-on-surface-variant">
            Overall
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="font-code-sm font-bold uppercase tracking-wider text-primary">
          {activeLevel !== null
            ? `Tier ${activeLevel} Qualified`
            : completed === total
              ? "Curriculum Cleared"
              : "No Progress Yet"}
        </span>
        <span className="mt-0.5 font-body-md font-medium text-on-surface">
          {completed} / {total} Mastered
        </span>
        <span className="mt-1 font-body-sm text-on-surface-variant">
          {Math.max(0, total - completed)} modules remaining
        </span>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest">
          <div
            className="h-full rounded-full bg-primary-container shadow-[0_0_8px_rgb(249_115_22_calc(0.8_*_var(--accent-alpha)))]"
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
            <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-high px-space-xs py-space-2xs font-code-sm uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
              SYLLABUS ARCHITECTURE // V2.4
            </span>
            <span className="font-code-sm text-code-sm text-on-surface-variant">
              • DETERMINISTIC MOTOR PATHWAYS
            </span>
          </div>
          <h1 className="font-display-lg text-display-lg tracking-tight text-on-surface">
            Curriculum &amp; Syllabus Directory
          </h1>
          <p className="mt-space-xs max-w-xl font-body-md text-body-md text-on-surface-variant">
            Master {TOTAL_LESSONS} deterministic neuromuscular modules from
            low-level home-row cadence to bare-metal kernel abstractions and
            multithreaded syntax conduits.
          </p>
          <div className="mt-space-base flex flex-wrap items-center gap-space-md">
            <div className="flex items-center gap-space-xs rounded bg-surface-container px-space-sm py-space-xs">
              <span className="material-symbols-outlined text-[18px] text-primary">speed</span>
              <div className="flex flex-col">
                <span className="font-code-sm text-code-sm uppercase text-on-surface-variant">
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
                <span className="font-code-sm text-code-sm uppercase text-on-surface-variant">
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
                <span className="font-code-sm text-code-sm uppercase text-on-surface-variant">
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

function ModuleCard({
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
        MODULE {moduleNo}
        {status === "active" ? " // ACTIVE" : ""}
      </span>
      {status === "completed" && (
        <span className="inline-flex items-center gap-1 rounded bg-surface-container-high px-1.5 py-0.5 font-code-sm text-[10px] font-semibold text-secondary">
          <span className="material-symbols-outlined text-[12px]">check_circle</span> MASTERED
        </span>
      )}
      {status === "active" && (
        <span className="inline-flex items-center gap-1 rounded bg-primary-container px-2 py-0.5 font-code-sm text-[10px] font-bold text-on-primary-container shadow-sm">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-on-primary-container" /> IN PROGRESS
        </span>
      )}
      {status === "available" && (
        <span className="inline-flex items-center gap-1 rounded bg-surface-container-high px-1.5 py-0.5 font-code-sm text-[10px] font-semibold text-primary">
          <span className="material-symbols-outlined text-[12px]">lock_open</span> READY
        </span>
      )}
      {status === "locked" && (
        <span className="inline-flex items-center gap-1 rounded bg-surface-container-lowest px-1.5 py-0.5 font-code-sm text-[10px] text-on-surface-variant/60">
          <span className="material-symbols-outlined text-[12px]">lock</span> LOCKED
        </span>
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
            RECORD: <strong className="text-on-surface">{fmt1(progress.bestWpm)} WPM</strong>
          </span>
          <span>
            ACCURACY: <strong className="text-secondary">{fmt1(progress.bestAccuracy)}%</strong>
          </span>
        </div>
      )}
      {status === "active" && (
        <div className="mb-space-xs flex items-center justify-between rounded bg-surface-container-low px-2 py-space-xs font-code-sm text-code-sm text-on-surface-variant">
          <span>
            {progress && progress.attemptCount > 0 ? "BEST ATTEMPT: " : "FIRST ATTEMPT: "}
            <strong className="text-on-surface">
              {progress && progress.bestWpm > 0 ? `${fmt1(progress.bestWpm)} WPM` : "—"}
            </strong>
          </span>
          <span className={progress && progress.bestAccuracy >= ACCURACY_GATE ? "text-secondary" : "text-error"}>
            {progress && progress.attemptCount > 0
              ? `${fmt1(progress.bestAccuracy)}% ACC${progress.bestAccuracy >= ACCURACY_GATE ? "" : ` (NEEDS ${ACCURACY_GATE}%)`}`
              : `0.0% ACC (NEEDS ${ACCURACY_GATE}%)`}
          </span>
        </div>
      )}
      {status === "available" && (
        <div className="py-space-xs text-center font-code-sm text-code-sm text-on-surface-variant">
          <span>
            TARGET SPEED: <strong className="text-primary">&gt; 45 WPM</strong> • PASS ACC:{" "}
            <strong className="text-primary">{ACCURACY_GATE}.0%</strong>
          </span>
        </div>
      )}
      {status === "locked" && (
        <div className="py-space-xs text-center font-code-sm text-code-sm text-on-surface-variant/70">
          Requires &gt;= {ACCURACY_GATE}% Acc on the previous module
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
              ? "bg-primary-container py-2.5 font-bold text-on-primary-container shadow-[0_0_16px_rgb(249_115_22_calc(0.4_*_var(--accent-alpha)))] hover:bg-tertiary-container"
              : "bg-surface-container-high text-on-surface hover:bg-primary-container hover:text-on-primary-container",
          )}
        >
          <span className="material-symbols-outlined text-[16px]">
            {status === "completed" ? "replay" : status === "active" ? "play_arrow" : "start"}
          </span>
          <span>
            {status === "completed"
              ? "Replay Drill"
              : status === "active"
                ? `Resume ${moduleNo}`
                : "Start Module"}
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
          ? "overflow-hidden bg-surface-container shadow-2xl shadow-[0_0_24px_rgb(249_115_22_calc(0.25_*_var(--accent-alpha)))]"
          : status === "locked"
            ? "bg-surface-container-lowest/60 opacity-75 backdrop-blur-sm"
            : "group bg-surface-container-lowest shadow-sm hover:bg-surface-container",
      )}
    >
      {activeHighlight && (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-primary-container" />
          <div className="pointer-events-none absolute -bottom-8 -right-8 h-28 w-28 rounded-full bg-primary-container/20 blur-xl" />
        </>
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
}

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
  onToggle: () => void;
}) {
  const total = level.lessons.length;
  const isComplete = completedCount === total;
  const isUntouched = completedCount === 0;
  const isActive = !isComplete && !isUntouched;

  // Average best stats over attempted lessons (DB truth, not invented).
  const attempted = level.lessons.filter(
    (lesson) => (progress[lesson.id]?.attemptCount ?? 0) > 0,
  );
  const avgWpm = attempted.length
    ? attempted.reduce((sum, l) => sum + (progress[l.id]?.bestWpm ?? 0), 0) / attempted.length
    : null;
  const avgAcc = attempted.length
    ? attempted.reduce((sum, l) => sum + (progress[l.id]?.bestAccuracy ?? 0), 0) / attempted.length
    : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full flex-col justify-between gap-space-sm rounded-xl p-space-base text-left transition-all sm:flex-row sm:items-center",
        isActive
          ? "relative overflow-hidden bg-surface-container shadow-2xl"
          : isUntouched
            ? "bg-surface-container-lowest/50 opacity-60"
            : "cursor-pointer bg-surface-container-lowest hover:bg-surface-container-low",
      )}
    >
      {isActive && expanded && (
        <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-primary-container via-primary to-primary-container" />
      )}
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
          <div className="flex items-center gap-space-xs">
            <span
              className={cn(
                "font-code-sm font-bold uppercase tracking-widest text-code-sm",
                isActive ? "text-primary" : isComplete ? "text-secondary" : "text-on-surface-variant",
              )}
            >
              LEVEL {String(level.level).padStart(2, "0")} // {level.tagline}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 font-code-sm text-[10px] font-semibold uppercase",
                isComplete
                  ? "bg-secondary-container/20 text-secondary"
                  : isActive
                    ? "bg-primary-container/20 text-primary"
                    : "bg-surface-container text-on-surface-variant",
              )}
            >
              {isComplete
                ? "100% COMPLETE"
                : isActive
                  ? `${completedCount} OF ${total} MASTERED`
                  : `LOCKED (0/${total})`}
            </span>
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
            <span className="block text-on-surface-variant">SPEED</span>
            <span className="font-semibold text-on-surface">
              {avgWpm !== null ? `${fmt1(avgWpm)} WPM` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">ACCURACY</span>
            <span className="font-semibold text-on-surface">
              {avgAcc !== null ? `${fmt1(avgAcc)}%` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">MODULES</span>
            <span className={cn("font-semibold", completedCount > 0 ? "text-primary" : "text-on-surface")}>
              {completedCount} / {total}
            </span>
          </div>
        </div>
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </div>
    </button>
  );
}

function LevelSection({
  level,
  progress,
  expanded,
  onToggle,
  viewMode,
}: {
  level: CurriculumLevel;
  progress: Record<string, LessonProgress>;
  expanded: boolean;
  onToggle: () => void;
  viewMode: ViewMode;
}) {
  const completedCount = level.lessons.filter(
    (lesson) => lessonStatus(progress, lesson.id) === "completed",
  ).length;
  const isActive = level.lessons.some(
    (lesson) => lessonStatus(progress, lesson.id) === "available",
  );

  return (
    <div className="flex flex-col">
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
              <span className="font-medium text-on-surface">Clearance Criteria:</span>
              <span>
                Must sustain <span className="font-bold text-primary">&gt;= {ACCURACY_GATE}% Accuracy</span> &amp;{" "}
                <span className="font-bold text-primary">&gt; 45 WPM</span> in the same attempt to
                unlock subsequent modules.
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
}

/* ---------------------------------------------------------------------------
 * Symbol latency telemetry
 * ------------------------------------------------------------------------- */

const FOCUS_SYMBOLS = [
  "-", ">", ":", "&", "=", "(", ")", "{", "}", "[", "]", ";", "_", "*", "/", "!", "?",
];

function SymbolTelemetry({ keys }: { keys: KeyStatRow[] }) {
  // Only programming-symbol chips, ranked by volume; hidden entirely when
  // there is not enough data (graceful empty state per the plan).
  const chips = keys
    .filter((row) => FOCUS_SYMBOLS.includes(row.key) && row.totalPresses >= 5)
    .sort((a, b) => b.totalPresses - a.totalPresses)
    .slice(0, 7);

  if (chips.length === 0) return null;

  const maxLatency = Math.max(...chips.map((c) => c.avgLatencyMs), 1);

  return (
    <div className="rounded-xl bg-surface-container-low p-space-base shadow-xl">
      <div className="mb-space-base flex flex-col justify-between gap-space-sm md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[18px] text-primary">query_stats</span>
            <h3 className="font-headline-md text-headline-md text-on-surface">
              Symbol Latency Telemetry
            </h3>
          </div>
          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
            Real-time neuromuscular cadence across key programming tokens.
            Hesitations (&gt;180ms) indicate target friction zones.
          </p>
        </div>
        <div className="flex items-center gap-space-base font-code-sm text-code-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-secondary" />
            <span className="text-on-surface-variant">Fast (&lt;100ms)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="text-on-surface-variant">Optimal (100–180ms)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary-container" />
            <span className="text-on-surface-variant">Hesitation (&gt;180ms)</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4 lg:grid-cols-7">
        {chips.map((chip) => {
          const latency = Math.round(chip.avgLatencyMs);
          const heightPct = Math.max(12, Math.round((chip.avgLatencyMs / maxLatency) * 100));
          const tone =
            latency > 180
              ? { bar: "bg-primary-container", label: "text-error", tag: latency > 200 ? "HESITATION" : "FRICTION" }
              : latency >= 100
                ? { bar: "bg-primary", label: "text-on-surface-variant", tag: "NOMINAL" }
                : { bar: "bg-secondary", label: "text-secondary", tag: "OPTIMAL" };
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
}

/* ---------------------------------------------------------------------------
 * Screen
 * ------------------------------------------------------------------------- */

function matchesQuery(lesson: Lesson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    lesson.title.toLowerCase().includes(q) ||
    lesson.description.toLowerCase().includes(q) ||
    lesson.tags.some((tag) => tag.toLowerCase().includes(q)) ||
    lesson.targetKeys.some((key) => key.toLowerCase().includes(q))
  );
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
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Active engagement level = first level containing an available lesson.
  const activeLevel = useMemo(() => {
    for (const level of CURRICULUM_LEVELS) {
      if (level.lessons.some((lesson) => lessonStatus(progress, lesson.id) === "available")) {
        return level.level;
      }
    }
    return null;
  }, [progress]);

  const toggleLevel = (level: number) => {
    setManualExpanded((prev) => {
      const base = prev ?? (activeLevel !== null ? new Set([activeLevel]) : new Set([1]));
      const next = new Set(base);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

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

  // Ctrl+K focuses search (per the design's micro-interaction script).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // Filtering pipeline: search -> status pill -> level dropdown.
  const visibleLevels = useMemo(() => {
    return CURRICULUM_LEVELS.map((level) => ({
      level,
      lessons: level.lessons.filter((lesson) => {
        if (!matchesQuery(lesson, query)) return false;
        if (statusFilter !== "all" && statusOf(progress[lesson.id]) !== statusFilter) return false;
        if (levelFilter !== "all" && level.level !== levelFilter) return false;
        return true;
      }),
    })).filter((entry) => entry.lessons.length > 0);
  }, [query, statusFilter, levelFilter, progress]);

  const searching = query.trim() !== "" || statusFilter !== "all" || levelFilter !== "all";
  const expandedLevels = manualExpanded ?? (activeLevel !== null ? new Set([activeLevel]) : new Set([1]));

  if (!loaded) {
    return (
      <main className="flex w-full flex-1 items-center justify-center bg-surface">
        <span className="font-code-md text-code-md text-on-surface-variant">
          LOADING CURRICULUM…
        </span>
      </main>
    );
  }

  return (
    <main className="w-full flex-1 overflow-y-auto bg-surface px-gutter-desktop pb-space-lg pt-4">
      <div className="flex w-full flex-col">
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
            <span>PROGRESS UNAVAILABLE: {dbError} — module states shown as locked.</span>
          </div>
        )}

        {/* Control bar */}
        <div className="mb-space-base flex flex-col items-stretch justify-between gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm shadow-sm lg:flex-row lg:items-center">
          <div className="relative min-w-[280px] flex-1">
            <span className="material-symbols-outlined absolute left-space-sm top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
              className="rounded-lg bg-surface-container py-2 pl-space-sm pr-space-sm font-label-md text-label-md text-on-surface transition-colors focus:outline-none"
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

        {/* Level sections */}
        <div className="mb-space-xl flex flex-col gap-space-base">
          {visibleLevels.length === 0 ? (
            <div className="rounded-xl bg-surface-container-lowest p-space-xl text-center font-code-md text-code-md text-on-surface-variant">
              No modules match the current search or filters.
            </div>
          ) : (
            visibleLevels.map(({ level }) => (
              <LevelSection
                key={level.level}
                level={level}
                progress={progress}
                expanded={searching || expandedLevels.has(level.level)}
                onToggle={() => toggleLevel(level.level)}
                viewMode={viewMode}
              />
            ))
          )}
        </div>

        {showTelemetryStrip && <SymbolTelemetry keys={keyStats} />}
      </div>
    </main>
  );
}
