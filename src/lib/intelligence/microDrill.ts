import { LessonSchema, type DrillConfig, type Lesson } from "../schemas";
import { CHAR_FAMILIES, CORPUS_WORDS, hashSeed, mulberry32 } from "./adaptiveGenerator";
import { ELIMINATED_THRESHOLD } from "./analyzer";
import { DEFAULT_DRILL_CONFIG, type DrillPlan } from "./drillService";

/**
 * Targeted Micro-Drill builder (UX plan §7.1) + rapid-fire set messaging
 * (§7.2) — pure, deterministic, DOM-free; the Results screen only wires the
 * `D` press and the Weakness screen renders what these functions return.
 *
 * Why not reuse `generateDrillSets` (§7.2 asked to check first): it derives
 * its weak chars from a `WeaknessAnalysis` via `focusKeysOf`, hard-excludes
 * `"\n"` from injection, and injects them *probabilistically* through the
 * weighted `{S}`/`{B}` template slots — so no per-seed guarantee exists that
 * every missed key lands ≥ N times (nor that a missed Enter is trained at
 * all). The micro-drill contract is the opposite: exact focus keys, hard
 * coverage floor, one short set. Hence a small dedicated generator with a
 * final coverage pass, still seeded by the same `mulberry32`/`hashSeed`
 * pair so it is deterministic per (missed keys, seed).
 *
 * Persistence is NOT this module's job: the session store's finish pipeline
 * writes the set as a `kind='weakness'` attempt (lesson_id NULL) and the
 * curriculum unlock gates are never touched.
 */

/* --------------------------- sizing constants --------------------------- */

/**
 * §7.1 — keystrokes in the single micro-drill set: ≈45 s for an intermediate
 * typist. Arithmetic: ~40 WPM × 5 chars/word = 200 gross chars/min, of which
 * ≈150 land as steady typing once code punctuation and micro-pauses are
 * counted (the plan's "≈150 chars/min"), so
 *
 *     150 chars/min × 45 s ÷ 60 s/min = 112.5 → 112 keystrokes
 *
 * (inside the plan's 110–150 window and `DrillConfigSchema`'s 40–400 bound).
 */
export const MICRO_DRILL_SET_LENGTH = 112;

/** §7.1 — every missed char must appear at least this often in the set. */
export const MIN_FOCUS_OCCURRENCES = 3;

/** Longest generated line — the set stays a scannable ~3 lines of code. */
export const MICRO_MAX_LINE_LENGTH = 40;

/** Max focus chars the plan will drill (Results offers its worst 3 anyway). */
const MAX_FOCUS_KEYS = 5;

/**
 * The character contract asserted by the unit tests: printable ASCII plus
 * the newline separator (never a control char, never a tab — `LessonSchema`
 * rejects tabs).
 */
export const PRINTABLE_CODE_TEXT = /^[\x20-\x7E\n]+$/;

/** Neutral code punctuation filling non-focus slots. */
const SYMBOL_FILLERS = [",", ";", ".", "-", "_", "=", "(", ")", "/", "+", "[", "]"];

/** Readable names for the whitespace focus chars (title + messages). */
const TITLE_NAMES: Record<string, string> = { "\n": "Enter", " ": "Space", "\t": "Tab" };

/* ------------------------------ generation ------------------------------ */

/** Dedupes, drops empties and caps the focus set at {@link MAX_FOCUS_KEYS}. */
function focusKeysOfMissed(missedKeys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of missedKeys) {
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_FOCUS_KEYS) break;
  }
  return out;
}

/** The focus chars that may appear *inside* a line (`\n` only joins lines). */
const inLineFocus = (keys: readonly string[]): string[] => keys.filter((k) => k !== "\n");

const sampleFrom = (rng: () => number, chars: readonly string[]): string =>
  chars[Math.floor(rng() * chars.length)] ?? "";

const countOf = (text: string, key: string): number => text.split(key).length - 1;

/**
 * One code-like token, heavily weighted to the missed chars: ~45% focus runs
 * (2-3 missed chars), then corpus identifiers (sometimes suffixed with a
 * missed char, e.g. `retry:`), numbers and neutral symbols. Always returns
 * 1..`room` chars so a line can be filled to an exact length.
 */
function sampleToken(rng: () => number, focus: readonly string[], room: number): string {
  const roll = rng();
  if (focus.length > 0 && roll < 0.45) {
    const run = Math.min(room, 2 + Math.floor(rng() * 2));
    let out = "";
    for (let i = 0; i < run; i++) out += sampleFrom(rng, focus);
    return out;
  }
  if (roll < 0.8) {
    const fits = CORPUS_WORDS.filter((word) => word.length <= room);
    if (fits.length > 0) {
      const word = sampleFrom(rng, fits);
      if (focus.length > 0 && word.length < room && rng() < 0.5) {
        return word + sampleFrom(rng, focus);
      }
      return word;
    }
  } else if (roll < 0.92) {
    return String(1 + Math.floor(rng() * 256)).slice(0, room);
  }
  return sampleFrom(rng, SYMBOL_FILLERS);
}

/** Fills exactly `length` chars with tokens joined by single spaces. */
function buildLine(length: number, focus: readonly string[], rng: () => number): string {
  if (length <= 0) return "";
  const inLine = inLineFocus(focus);
  let out = "";
  let guard = 0;
  while (out.length < length && guard < 400) {
    guard += 1;
    const separator = out.length > 0 ? 1 : 0;
    const room = length - out.length - separator;
    if (room < 1) break;
    const token = sampleToken(rng, inLine, room);
    if (token.length === 0 || token.length > room) break;
    out += (separator === 1 ? " " : "") + token;
  }
  if (out.length < length) {
    const fill = inLine.length > 0 ? sampleFrom(rng, inLine) : ",";
    out += fill.repeat(length - out.length);
  }
  return out;
}

/**
 * Hard coverage floor (the contract's ≥ MIN_FOCUS_OCCURRENCES per key):
 * newline focus is satisfied by having enough line joins, every other key by
 * appending focus tokens until the count is met. Each iteration strictly
 * increases the count, so the guard can never spin.
 */
function ensureCoverage(content: string, focus: readonly string[], rng: () => number): string {
  if (focus.length === 0) return content;
  const lines = content.split("\n");
  const inLine = inLineFocus(focus);

  if (focus.includes("\n")) {
    while (lines.length - 1 < MIN_FOCUS_OCCURRENCES) {
      lines.push(buildLine(Math.min(MICRO_MAX_LINE_LENGTH, 16), inLine, rng));
    }
  }

  let text = lines.join("\n");
  for (const key of focus) {
    if (key === "\n") continue;
    let guard = 0;
    while (countOf(text, key) < MIN_FOCUS_OCCURRENCES && guard < 64) {
      guard += 1;
      // APPEND ONLY — never replace: overwriting the last line would destroy
      // content already placed there (and every other key's coverage with
      // it). A full last line gets a fresh line instead.
      const last = lines[lines.length - 1];
      if (last.length + key.length + 1 > MICRO_MAX_LINE_LENGTH) lines.push(key);
      else lines[lines.length - 1] = `${last} ${key}`;
      text = lines.join("\n");
    }
  }
  return text;
}

/**
 * Deterministic content: `lineCount = ceil(target / MICRO_MAX_LINE_LENGTH)`
 * (≈3 lines at 112 keys; +1 line when Enter itself is a missed key so the
 * joins alone cover it), lines sized to sum to exactly `target` characters
 * including the newline separators, then the coverage pass.
 */
function buildContent(focus: readonly string[], seed: number, targetLength: number): string {
  const rng = mulberry32(hashSeed("micro-drill", seed, focus.join("\u0000"), targetLength));
  const lineCount = Math.max(
    Math.ceil(targetLength / MICRO_MAX_LINE_LENGTH),
    focus.includes("\n") ? MIN_FOCUS_OCCURRENCES + 1 : 1,
  );
  const separators = lineCount - 1;
  const bodyLength = Math.max(lineCount, targetLength - separators);
  const base = Math.floor(bodyLength / lineCount);
  let remainder = bodyLength - base * lineCount;

  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    const length = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    lines.push(buildLine(length, focus, rng));
  }
  return ensureCoverage(lines.join("\n"), focus, rng);
}

/* -------------------------------- titles -------------------------------- */

function labelFor(key: string): string {
  return TITLE_NAMES[key] ?? CHAR_FAMILIES[key] ?? `'${key}'`;
}

function microTitle(keys: readonly string[]): string {
  if (keys.length === 0) return "Micro-Drill: Free Practice";
  return `Micro-Drill: ${keys.slice(0, 3).map(labelFor).join(", ")}`;
}

/**
 * Focus-key digest folded into the plan id: the Weakness screen matches its
 * return hint on `sets[0].id`, so two plans built from DIFFERENT focus sets
 * must never collide on a shared seed. Each key contributes its code point
 * in base36; the `.` separator is not a base36 digit, so the join is
 * unambiguous (`{` + `:` → `7b.3a`, never confusable with one key 0x7b3a).
 */
function focusDigest(keys: readonly string[]): string {
  return keys.map((key) => (key.codePointAt(0) ?? 0).toString(36)).join(".");
}

/* ------------------------------ public API ------------------------------ */

/**
 * §7.1 — composes the ephemeral drill launched by `D` on the Results
 * screen: ONE set of {@link MICRO_DRILL_SET_LENGTH} keys (≈45 s), focus
 * keys = the attempt's worst missed chars (deduped, capped at 5), config =
 * `DEFAULT_DRILL_CONFIG` narrowed to `sets: 1`. Deterministic per
 * (missedKeys, seed). Passing this plan to `startDrill` persists it through
 * the store's existing `kind='weakness'` pipeline — no extra persistence,
 * no curriculum progress paths.
 */
export function buildMicroDrillPlan(
  missedKeys: readonly string[],
  seed: number,
  userLevel: number,
): DrillPlan {
  const focusKeys = focusKeysOfMissed(missedKeys);
  const level = Math.min(7, Math.max(1, Math.round(userLevel)));
  const config: DrillConfig = {
    ...DEFAULT_DRILL_CONFIG,
    sets: 1,
    setLength: MICRO_DRILL_SET_LENGTH,
  };
  const content = buildContent(focusKeys, seed, MICRO_DRILL_SET_LENGTH);
  const lesson: Lesson = LessonSchema.parse({
    id: `micro-${seed.toString(36)}${
      focusKeys.length > 0 ? `-${focusDigest(focusKeys)}` : ""
    }`,
    level,
    orderIndex: 0,
    title: microTitle(focusKeys),
    description:
      focusKeys.length === 0
        ? "Free-practice micro-drill."
        : `45-second targeted micro-drill on the keys you keep missing: ${focusKeys
            .map(labelFor)
            .join(", ")}.`,
    content,
    targetKeys: focusKeys,
    tags: ["weakness", "micro"],
    source: "builtin",
    createdAt: 0,
  });
  return { seed, config, focusKeys, sets: [lesson], weakChars: [focusKeys] };
}

/* --------------------------- §7.2 set messaging -------------------------- */

/** Display form of a focus key inside a message (`\n` → `\n` escaped). */
function displayKey(key: string): string {
  if (key === "\n") return "\\n";
  if (key === " ") return "␣";
  return key;
}

/**
 * §7.2 — the target-elimination line rendered under a set summary:
 * `Target { : Eliminated! Accuracy 78% → 96%` once the set lands at/above
 * the analyzer's elimination threshold, otherwise honest partial progress
 * (improving / holding / slipping). Pure string building; `prev` is null
 * when no baseline accuracy exists yet (first set, key not in the queue).
 */
export function eliminationMessage(
  prev: number | null,
  next: number,
  keys: readonly string[],
): string {
  const label = keys.length > 0 ? keys.map(displayKey).join(" ") : "—";
  // Compare RAW percentages (the analyzer's `accuracy >= 95` rule is raw
  // too) and round only for display, so 94.6 % can never claim elimination.
  if (prev === null) {
    return `Target ${label}: accuracy ${Math.round(next)}% this set — no baseline yet`;
  }
  const arrow = `Accuracy ${Math.round(prev)}% → ${Math.round(next)}%`;
  if (next >= ELIMINATED_THRESHOLD) return `Target ${label} Eliminated! ${arrow}`;
  const needs = ` (needs ≥${ELIMINATED_THRESHOLD}%)`;
  if (next > prev) return `Target ${label} Improving — ${arrow}${needs}`;
  if (next < prev) return `Target ${label} Slipping — ${arrow}${needs}`;
  return `Target ${label} Holding — ${arrow}${needs}`;
}

/* --------------------- §7.1 return-to-results hint ----------------------- */

/** sessionStorage key for the Results screen the micro-drill came from. */
export const MICRO_DRILL_RETURN_KEY = "typekernel.microDrillReturn";

/** Where `D` launched from — `attemptId` null = persistence had failed. */
export interface MicroDrillReturnHint {
  attemptId: number | null;
  /**
   * id of the drill plan this hint belongs to (`DrillPlan.sets[0].id`).
   * The Weakness screen only offers the return when the finished drill's
   * plan matches, so an abandoned micro-drill can never leak a stale jump
   * into some later, unrelated drill. Optional so hints written by an older
   * build simply fail the match instead of crashing the reader.
   */
  planId?: string;
}

/** Narrowed `sessionStorage` so tests can inject a plain fake. */
export type HintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `null` outside a browser (node tests) — all helpers then no-op safely. */
function defaultHintStorage(): HintStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Stashes the hint at `D`-press so the drill can return to its Results. */
export function stashMicroDrillReturn(
  hint: MicroDrillReturnHint,
  storage: HintStorage | null = defaultHintStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(MICRO_DRILL_RETURN_KEY, JSON.stringify(hint));
  } catch {
    // Storage full / private mode — the drill simply runs without a return.
  }
}

/**
 * Reads the hint; absent, malformed or non-object JSON all mean "no hint"
 * (`null`), so a corrupted value can never break the Weakness screen.
 */
export function readMicroDrillReturn(
  storage: HintStorage | null = defaultHintStorage(),
): MicroDrillReturnHint | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(MICRO_DRILL_RETURN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("attemptId" in parsed)) return null;
    const { attemptId, planId } = parsed as { attemptId?: unknown; planId?: unknown };
    const validAttemptId = typeof attemptId === "number" && Number.isInteger(attemptId);
    return {
      attemptId: validAttemptId ? attemptId : null,
      ...(typeof planId === "string" ? { planId } : {}),
    };
  } catch {
    return null;
  }
}

/** Consumes the hint (called when the user actually returns to Results). */
export function clearMicroDrillReturn(
  storage: HintStorage | null = defaultHintStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(MICRO_DRILL_RETURN_KEY);
  } catch {
    // Best effort — a stale hint degrades to the default finished screen.
  }
}
