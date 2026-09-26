import { CURRICULUM_LEVELS, lessonsByLevel } from "../../content";
import type { Lesson, LessonProgress } from "../schemas";

/**
 * Frontier navigation (UX plan §6.1–§6.4) — the pure decision layer behind
 * the Lessons screen's Phase 3 surfaces:
 *
 * - §6.1 the sticky "Resume Frontier" HUD (frontier level mastery bar),
 * - §6.2 the level mini-map / jump rail (per-level completion summaries),
 * - §6.3 the instant syntax & symbol filter chips,
 * - §6.4 the level milestone summary modal (which level is celebrated).
 *
 * No DOM, no React, no storage here — screens wire it up and the rules are
 * unit-tested against the real 260-lesson curriculum.
 */

/* ---------------------------------------------------------------------------
 * §6.3 — syntax & symbol filter chips
 * ------------------------------------------------------------------------- */

export type SymbolChipId =
  | "braces"
  | "parens"
  | "arrays"
  | "generics"
  | "arrows"
  | "operators"
  | "async"
  | "sql";

export interface SymbolChip {
  id: SymbolChipId;
  /** Design label exactly as specified in UX plan §6.3. */
  label: string;
}

/** The §6.3 chip bar, in design order. */
export const SYMBOL_CHIPS: readonly SymbolChip[] = [
  { id: "braces", label: "{ Brackets }" },
  { id: "parens", label: "( Parens )" },
  { id: "arrays", label: "[ Arrays ]" },
  { id: "generics", label: "< Generics >" },
  { id: "arrows", label: "=> Arrows" },
  { id: "operators", label: "&& Operators" },
  { id: "async", label: "async/await" },
  { id: "sql", label: "SQL" },
];

export const SYMBOL_CHIP_IDS: readonly SymbolChipId[] = SYMBOL_CHIPS.map(
  (chip) => chip.id,
);

/** Title + description + content + tags — everything a chip may match on. */
function haystack(lesson: Lesson): string {
  return `${lesson.title}\n${lesson.description}\n${lesson.content}\n${lesson.tags.join(" ")}`;
}

/**
 * Uppercase SQL statements (the curriculum writes SQL in caps) — the word
 * "sql" itself is matched separately, case-insensitively, so lowercase prose
 * like "the SQL convention" still counts while a bare lowercase `join` verb
 * in an English description does not.
 */
const SQL_STATEMENT =
  /\bSELECT\b[\s\S]*?\bFROM\b|\bCREATE TABLE\b|\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE\b[\s\S]*?\bSET\b|\b(?:INNER|LEFT|RIGHT|FULL) JOIN\b|\bJOIN\b/;

/**
 * §6.3 matcher for one chip. Symbol chips are literal (a `{ Brackets }`
 * lesson really types a brace); word chips combine tags with keywords so the
 * `async/await` and `SQL` subsets are findable even when the construct is
 * only named in the title/description/tag list.
 */
export function matchesSymbolChip(lesson: Lesson, chipId: SymbolChipId): boolean {
  const content = lesson.content;
  const tags = lesson.tags.map((tag) => tag.toLowerCase());
  switch (chipId) {
    case "braces":
      return content.includes("{") || content.includes("}");
    case "parens":
      return content.includes("(") || content.includes(")");
    case "arrays":
      return content.includes("[") || content.includes("]");
    case "generics":
      return content.includes("<");
    case "arrows":
      return content.includes("=>");
    case "operators":
      return content.includes("&&") || tags.includes("operators");
    case "async":
      return tags.includes("async") || /\basync\b|\bawait\b/i.test(haystack(lesson));
    case "sql":
      return (
        tags.includes("sql") ||
        /\bsql\b/i.test(haystack(lesson)) ||
        SQL_STATEMENT.test(content)
      );
    default:
      return false;
  }
}

/**
 * §6.3 multi-select semantics: chips within the bar are OR (toggle a few
 * constructs to widen the slice), while the chip set as a whole ANDs with the
 * search/status/level filters of the screen pipeline. An empty selection
 * matches everything.
 */
export function matchesAnySymbolChip(
  lesson: Lesson,
  chipIds: ReadonlySet<SymbolChipId>,
): boolean {
  if (chipIds.size === 0) return true;
  for (const chipId of chipIds) {
    if (matchesSymbolChip(lesson, chipId)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * §6.1 / §6.2 — level mastery summaries
 * ------------------------------------------------------------------------- */

export interface LevelMastery {
  level: number;
  /** Full level name from the level meta (e.g. "Programming Syntax Patterns"). */
  name: string;
  /** The design's uppercase tier/track label (e.g. "STRUCTURES"). */
  tier: string;
  completed: number;
  total: number;
  /** Rounded 0–100 completion percentage. */
  pct: number;
  complete: boolean;
}

/** Completion summary for one curriculum level (HUD, mini-map, modal). */
export function summarizeLevel(
  level: number,
  progress: Record<string, LessonProgress>,
): LevelMastery {
  const meta = CURRICULUM_LEVELS.find((entry) => entry.level === level);
  const lessons = lessonsByLevel(level);
  let completed = 0;
  for (const lesson of lessons) {
    if (progress[lesson.id]?.status === "completed") completed += 1;
  }
  const total = lessons.length;
  return {
    level,
    name: meta?.name ?? `Level ${level}`,
    tier: meta?.tagline ?? "",
    completed,
    total,
    pct: total === 0 ? 0 : Math.round((completed / total) * 100),
    complete: total > 0 && completed === total,
  };
}

/**
 * §6.1 HUD meter: `Level 3 [========>-] 38/50`. The `>` cell is the frontier
 * cursor — always present while the level is in progress, always absent at
 * 100% where the bar reads `[==========]`.
 */
export function masteryBar(completed: number, total: number, width = 10): string {
  if (total <= 0 || width <= 0) return "[]";
  const clamped = Math.min(Math.max(Math.round(completed), 0), total);
  if (clamped >= total) return `[${"=".repeat(width)}]`;
  const filled = Math.min(Math.round((clamped / total) * width), width - 1);
  return `[${"=".repeat(filled)}>${"-".repeat(width - filled - 1)}]`;
}

/**
 * Average best-WPM / best-accuracy over the level's *attempted* lessons
 * (DB truth, never invented numbers). Null when nothing was attempted yet.
 */
export function averageLevelStats(
  level: number,
  progress: Record<string, LessonProgress>,
): { wpm: number; accuracy: number } | null {
  const attempted = lessonsByLevel(level).filter(
    (lesson) => (progress[lesson.id]?.attemptCount ?? 0) > 0,
  );
  if (attempted.length === 0) return null;
  const wpm =
    attempted.reduce((sum, lesson) => sum + (progress[lesson.id]?.bestWpm ?? 0), 0) /
    attempted.length;
  const accuracy =
    attempted.reduce(
      (sum, lesson) => sum + (progress[lesson.id]?.bestAccuracy ?? 0),
      0,
    ) / attempted.length;
  return { wpm, accuracy };
}

/** First lesson of the level currently sitting in the `available` state. */
export function firstAvailableLessonInLevel(
  level: number,
  progress: Record<string, LessonProgress>,
): Lesson | null {
  return (
    lessonsByLevel(level).find(
      (lesson) => progress[lesson.id]?.status === "available",
    ) ?? null
  );
}

/* ---------------------------------------------------------------------------
 * §6.4 — level milestone acknowledgement
 * ------------------------------------------------------------------------- */

/** localStorage key for one level's "already celebrated" acknowledgement. */
export function milestoneAckKey(level: number): string {
  return `typekernel.milestone.L${level}`;
}

/**
 * Every level that is 100% complete but has never been acknowledged, in
 * ascending order (the natural completion order — L3 cannot be complete
 * before L1/L2 are).
 */
export function pendingMilestoneLevels(
  acknowledged: ReadonlySet<string>,
  progress: Record<string, LessonProgress>,
): number[] {
  const pending: number[] = [];
  for (const level of CURRICULUM_LEVELS) {
    const mastery = summarizeLevel(level.level, progress);
    if (!mastery.complete) continue;
    if (acknowledged.has(milestoneAckKey(level.level))) continue;
    pending.push(level.level);
  }
  return pending;
}

/**
 * The level the §6.4 modal should celebrate: the MOST RECENT completion
 * (highest pending level — unlock order makes it the freshest 0→100
 * transition) or null when nothing is pending. Older uncelebrated
 * completions are acknowledged in the same batch by the screen, so landing
 * on Lessons never chains back-to-back modals.
 */
export function nextMilestoneToCelebrate(
  acknowledged: ReadonlySet<string>,
  progress: Record<string, LessonProgress>,
): number | null {
  const pending = pendingMilestoneLevels(acknowledged, progress);
  return pending.length === 0 ? null : pending[pending.length - 1];
}
