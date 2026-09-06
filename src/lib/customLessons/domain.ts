import { findKey, getActiveLayout } from "../layout";
import type { CustomLesson, Lesson } from "../schemas";

/**
 * Custom-lesson domain helpers (§16, Phase 7).
 *
 * Custom modules live OUTSIDE the §7/§8 unlock chain (plan §2): practicing
 * one routes into the normal session flow as `kind='custom'`, which requires
 * a `lessons` FK row — `toCurriculumLesson` derives that mirror from the
 * custom module (deterministic id `custom-<uuid>`, level 7, order index past
 * the curriculum). Target keys/symbols are auto-detected through the
 * Phase 3 keymap and stay user-editable afterwards.
 */

/** The `lessons`-table mirror id for a custom module (stable FK target). */
export function customLessonRef(id: string): string {
  return `custom-${id}`;
}

/** Inverse of {@link customLessonRef} (null for non-custom ids). */
export function customIdFromRef(ref: string): string | null {
  return ref.startsWith("custom-") ? ref.slice("custom-".length) : null;
}

/** Derives the `lessons` mirror row used for FK targets when practicing. */
export function toCurriculumLesson(lesson: CustomLesson): Lesson {
  return {
    id: customLessonRef(lesson.id),
    level: 7,
    // Past every curriculum module — never collides with generator output.
    orderIndex: 10_000,
    title: lesson.title,
    description: lesson.description,
    content: lesson.content,
    targetKeys: [...lesson.targetKeys, ...lesson.targetSymbols],
    tags: lesson.tags,
    source: "custom",
    createdAt: lesson.createdAt,
  };
}

export interface DetectedTargets {
  /** Letters/digits the module trains. */
  keys: string[];
  /** Punctuation/symbols the module trains. */
  symbols: string[];
  /** Characters not produced by the active keymap (never auto-added). */
  unmapped: string[];
}

const isWordChar = (char: string): boolean => /[a-zA-Z0-9]/.test(char);

/**
 * Auto-detects target keys/symbols by mapping every distinct content char
 * through the ACTIVE keymap (plan §2: `shift_required` included in the
 * mapping; whitespace/newlines are never targets). Re-run only while the
 * user has not manually edited the chips.
 */
export function detectTargets(content: string): DetectedTargets {
  const layout = getActiveLayout();
  const keys: string[] = [];
  const symbols: string[] = [];
  const unmapped: string[] = [];
  for (const char of new Set(Array.from(content))) {
    if (char === "\n" || char === " " || char === "\t") continue;
    if (findKey(layout, char) === null) {
      unmapped.push(char);
      continue;
    }
    (isWordChar(char) ? keys : symbols).push(char);
  }
  // Stable order: sort symbols by "code complexity" (plain ASCII first) so
  // the chips read deterministically across edits.
  symbols.sort();
  return { keys, symbols, unmapped };
}
