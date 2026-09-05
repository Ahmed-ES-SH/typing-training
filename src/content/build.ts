import { LessonSchema, type Lesson } from "../lib/schemas";

import {
  MAX_CONTENT_CHARS,
  MIN_CONTENT_CHARS,
  type LessonSpec,
} from "./types";

/**
 * Deterministic content-building helpers shared by the level generators.
 *
 * Everything here is pure arithmetic over fixed banks — no RNG, no Date.now(),
 * no global state — so the bundled curriculum is byte-stable across builds.
 */

/** Fixed creation timestamp so builds stay reproducible. */
export const CURRICULUM_CREATED_AT = Date.parse("2026-01-01T00:00:00Z");

/** Joins lines with real newlines (tabs are rejected by `LessonSchema`). */
export function joinLines(...lines: string[]): string {
  return lines.join("\n");
}

/** `unit` repeated `times`, space separated (`rep("f j", 4)` -> "f j f j f j f j"). */
export function rep(unit: string, times: number, sep = " "): string {
  return Array.from({ length: times }, () => unit).join(sep);
}

/** `lines` full lines of `frag` repeated `times` per line. */
export function drill(frag: string, times: number, lines: number): string {
  return Array.from({ length: lines }, () => rep(frag, times)).join("\n");
}

/**
 * Walks `bank` from offset `start` (wrapping) taking `count` entries —
 * deterministic rotation instead of shuffling.
 */
export function bankRun(
  bank: string[],
  start: number,
  count: number,
  sep = " ",
): string {
  return Array.from(
    { length: count },
    (_, i) => bank[(start + i) % bank.length],
  ).join(sep);
}

/** `lines` lines of `perLine` bank entries each, advancing through the bank. */
export function bankLines(
  bank: string[],
  start: number,
  perLine: number,
  lines: number,
): string {
  return Array.from(
    { length: lines },
    (_, l) => bankRun(bank, start + l * perLine, perLine),
  ).join("\n");
}

/**
 * Unique keys exercised by `content` (spaces/newlines excluded); any explicit
 * `spec` keys come first. Used as the default `target_keys` so the field is
 * accurate by construction — the §6.1 coverage test reads exactly this.
 */
export function keysOf(content: string, spec: string[] = []): string[] {
  const seen = new Set(spec);
  const ordered = [...spec];
  for (const ch of content) {
    if (ch === " " || ch === "\n") continue;
    if (!seen.has(ch)) {
      seen.add(ch);
      ordered.push(ch);
    }
  }
  return ordered;
}

/** The §6.1 symbol focus list (plan §3.3 coverage fixture). */
export const SYMBOL_FOCUS = [
  "(", ")", "{", "}", "[", "]", "<", ">", "/", "\\", "|", "&", "*",
  "=", "+", "-", "_", ":", ";", "'", '"', "`", "!", "?", "@", "#", "$",
] as const;

/** Assembles and validates one level's specs into final `Lesson[]` rows.
 * Collects every violation first so the thrown report is complete. */
export function assemble(level: number, specs: LessonSpec[]): Lesson[] {
  const violations: string[] = [];
  const lessons: Lesson[] = [];

  specs.forEach((spec, i) => {
    const id = `l${level}-${String(i + 1).padStart(3, "0")}`;
    if (spec.content.includes("\t")) {
      violations.push(`${id}: tabs are not allowed in lesson content`);
    }
    if (
      spec.content.length < MIN_CONTENT_CHARS ||
      spec.content.length > MAX_CONTENT_CHARS
    ) {
      violations.push(
        `${id}: content length ${spec.content.length} outside ` +
          `${MIN_CONTENT_CHARS}-${MAX_CONTENT_CHARS}`,
      );
    }
    lessons.push(
      LessonSchema.parse({
        id,
        level,
        orderIndex: i,
        title: spec.title,
        description: spec.description,
        content: spec.content,
        targetKeys: keysOf(spec.content, spec.targetKeys ?? []),
        tags: spec.tags ?? [],
        source: "builtin",
        createdAt: CURRICULUM_CREATED_AT,
      }),
    );
  });

  if (violations.length > 0) {
    throw new Error(`level ${level} content violations:\n${violations.join("\n")}`);
  }
  return lessons;
}
