import { LessonSchema, type Lesson, type DrillConfig } from "../schemas";
import { focusKeysOf, type WeaknessAnalysis } from "./analyzer";

/**
 * Adaptive content generator (PRD §13; Phase 6 plan §3.3).
 *
 * Deterministic given (analysis, seed, setIndex): a mulberry32 PRNG seeded
 * from all three drives every choice, so tests can assert exact properties
 * and the REGENERATE button only needs a new seed for new variety.
 *
 * Composition (plan §2): weak chars are injected at the configured weight
 * (default ×3) inside real code-identifier contexts drawn from a curated
 * word corpus — JSON-ish config lines, accessor chains, parameter lists —
 * with the analyzer's weak bigrams embedded where they fit naturally.
 * Guarantees (asserted by property tests):
 *   - every generated line contains at least one focus symbol or weak
 *     bigram (the first symbol slot of a line is always forced weak);
 *   - every letter run is a real corpus word — no random letter soup;
 *   - per-symbol frequency of each focus char ≈ `symbolWeight`× that of
 *     any distractor symbol.
 */

/** Curated identifier word corpus (the design's db_config / retry_map
 * / tls_context style). {I} slots compose words from this list. */
export const CORPUS_WORDS = [
  "config", "frame", "buffer", "host", "pool", "cache", "retry", "map",
  "backoff", "jitter", "sink", "file", "stderr", "logger", "verify",
  "defaults", "timeout", "handler", "stream", "reader", "writer", "parser",
  "context", "session", "token", "queue", "worker", "socket", "packet",
  "tls", "alpn", "db", "user", "path", "max", "min",
] as const;

/** Literal code words used by templates (allowed by the quality test). */
export const TEMPLATE_WORDS = ["ctx", "return"] as const;

/** Neutral symbols filling non-focus symbol slots (weight 1 each). */
export const DISTRACTOR_SYMBOLS = [",", ";", "-", "/", "@", "&"] as const;

/** Context templates (design's `ctx->frame_buffer` style).
 * `{I}` corpus identifier · `{N}` number · `{S}` weighted symbol slot ·
 * `{B}` weak-bigram slot. EVERY template contains `{S}` or `{B}` so each
 * generated line trains at least one focus symbol. Templates are tagged
 * with the minimum curriculum level at which their shapes are realistic. */
interface Template {
  minLevel: number;
  parts: string[];
}

const TEMPLATES: Template[] = [
  { minLevel: 3, parts: ["{S}", "{I}", ": ", "{I}", "{S}"] },
  { minLevel: 3, parts: ["{I}", "{B}", " ", "{I}", "{S}"] },
  { minLevel: 3, parts: ["ctx", "{B}", "{I}", " = ", "{N}", "{S}"] },
  { minLevel: 3, parts: ["{I}[", "{I}", "]", " = ", "{S}", "{N}"] },
  { minLevel: 3, parts: ["{S}", "{I}.", "{I}", " = ", "{I}", "{S}"] },
  { minLevel: 3, parts: ["return {I}", "{S}", "{N}", "; ", "{I}", "{S}"] },
  { minLevel: 3, parts: ["{I}(", "{N}", ", ", "{I}", ")", "{S}", " = ", "{I}"] },
  { minLevel: 2, parts: ["{I}_{I}", " = ", "{N}", "{S}", " ", "{S}"] },
  { minLevel: 2, parts: ["{I}(", "{N}", ", ", "{I}", ")", " ", "{S}", " ", "{S}"] },
  { minLevel: 1, parts: ["{I}", " ", "{I}", " ", "{N}", " ", "{S}", " ", "{S}"] },
];

/** Char names for drill titles and queue cards (the design's "left curly
 * brace" style). */
export const CHAR_NAMES: Record<string, string> = {
  "{": "left curly brace", "}": "right curly brace",
  "[": "left bracket", "]": "right bracket",
  ":": "colon", ";": "semicolon", "_": "underscore",
  "(": "left paren", ")": "right paren",
  "<": "angle bracket", ">": "angle bracket",
  "/": "slash", "\\": "backslash", "|": "pipe",
  "&": "ampersand", "*": "asterisk", "=": "equals", "+": "plus", "-": "dash",
  "'": "single quote", '"': "double quote", "`": "backtick", "!": "exclamation",
  "?": "question mark", "@": "at sign", "#": "hash", "$": "dollar",
  "%": "percent", "^": "caret", "~": "tilde", ".": "period", ",": "comma",
};

/** Title-case family name of a char ("Brace", "Colon", ...). */
export const CHAR_FAMILIES: Record<string, string> = {
  "{": "Brace", "}": "Brace", "[": "Bracket", "]": "Bracket",
  ":": "Colon", ";": "Semicolon", "_": "Underscore", "(": "Paren", ")": "Paren",
  "<": "Angle", ">": "Angle", "/": "Slash", "\\": "Backslash", "|": "Pipe",
  "&": "Ampersand", "*": "Asterisk", "=": "Equals", "+": "Plus", "-": "Dash",
  "'": "Quote", '"': "Double-Quote", "`": "Backtick", "!": "Bang",
  "?": "Question", "@": "At", "#": "Hash", "$": "Dollar", "%": "Percent",
  "^": "Caret", "~": "Tilde", ".": "Dot", ",": "Comma",
};

export interface GeneratorInput {
  analysis: WeaknessAnalysis;
  config: Pick<DrillConfig, "symbolWeight" | "setLength" | "wordContext">;
  seed: number;
  setIndex: number;
  /** Curriculum position — corpus templates are filtered by it. */
  userLevel: number;
}

export interface GeneratedSet {
  lesson: Lesson;
  /** Distinct weak chars whose weight drove the generation. */
  weakChars: string[];
}

/** Distinct weak chars the generator injects (targeted + maintenance). */
function weakCharsOf(analysis: WeaknessAnalysis): string[] {
  const chars = new Set<string>();
  for (const target of focusKeysOf(analysis, 6)) {
    if (target.key !== "\n") chars.add(target.key);
  }
  return [...chars];
}

/** Deterministic PRNG (mulberry32) — same family as the demo seeder. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a over the parts — derives a 32-bit seed from the inputs. */
export function hashSeed(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

/**
 * One symbol slot: every focus char carries `weight`, every distractor
 * symbol weight 1 — so over many slots each focus char appears ~`weight`×
 * as often as any distractor (the §13 "increases the appearance" rule and
 * the property tests' ratio assertion).
 */
function sampleSymbol(
  rng: () => number,
  weakChars: string[],
  weight: number,
): string {
  if (weakChars.length === 0) {
    return DISTRACTOR_SYMBOLS[Math.floor(rng() * DISTRACTOR_SYMBOLS.length)];
  }
  const totalWeight = weakChars.length * weight + DISTRACTOR_SYMBOLS.length;
  let roll = rng() * totalWeight;
  for (const weak of weakChars) {
    roll -= weight;
    if (roll < 0) return weak;
  }
  return DISTRACTOR_SYMBOLS[Math.floor(roll)] ?? ";";
}

/** A real identifier from the corpus ("retry", "db_config", ...). */
function sampleIdentifier(rng: () => number, input: GeneratorInput): string {
  const word = () => CORPUS_WORDS[Math.floor(rng() * CORPUS_WORDS.length)];
  const first = word();
  // Snake_case pairs read like the design's db_config / retry_map; the
  // "plain" word context keeps single words separated by spaces.
  if (input.config.wordContext === "code_identifiers" && rng() < 0.45) {
    let second = word();
    if (second === first) second = CORPUS_WORDS[(CORPUS_WORDS.indexOf(second) + 7) % CORPUS_WORDS.length];
    return `${first}_${second}`;
  }
  return first;
}

function sampleNumber(rng: () => number): string {
  return String(1 + Math.floor(rng() * 256));
}

/** The weak bigram to embed, or null when none fits. */
function weakBigram(analysis: WeaknessAnalysis, weakChars: string[]): string | null {
  for (const combo of analysis.combos) {
    if (weakChars.some((c) => combo.pair.includes(c)) && !combo.pair.includes("\n")) {
      return combo.pair;
    }
  }
  // No measured bigram (or none containing a weak char): glue two weak
  // chars / a weak char + underscore so transitions still get trained.
  if (weakChars.length >= 2) return `${weakChars[0]}${weakChars[1]}`;
  if (weakChars.length === 1) return `${weakChars[0]}_`;
  return null;
}

/** Marker tokenizer — parts may mix literals and markers ("{I}[" etc.). */
const MARKER_SPLIT = /(\{I\}|\{N\}|\{S\}|\{B\})/;

function fillTemplate(
  template: Template,
  rng: () => number,
  input: GeneratorInput,
  weakChars: string[],
  bigram: string | null,
): string {
  let out = "";
  for (const part of template.parts) {
    for (const token of part.split(MARKER_SPLIT)) {
      if (token === "" || token === undefined) continue;
      if (token === "{I}") {
        out += sampleIdentifier(rng, input);
      } else if (token === "{N}") {
        out += sampleNumber(rng);
      } else if (token === "{S}") {
        out += sampleSymbol(rng, weakChars, input.config.symbolWeight);
      } else if (token === "{B}") {
        // Weak-bigram slot: the analyzer's worst combo, or a weak-char pair.
        out += bigram ?? sampleSymbol(rng, weakChars, input.config.symbolWeight);
      } else {
        out += token;
      }
    }
  }
  return out;
}

/** True when `s` trains at least one focus char (or there are none). */
const coversFocus = (s: string, weakChars: string[]): boolean =>
  weakChars.length === 0 || weakChars.some((c) => s.includes(c));

/**
 * Fills a template and trims it to `room` WITHOUT losing focus coverage:
 * the design tints the focus symbols, so a trimmed line that dropped them
 * all would be dead practice. Retries a few times, then falls back to a
 * guaranteed-covered minimal line (leading focus char + corpus word).
 */
function fitCovered(
  template: Template,
  rng: () => number,
  input: GeneratorInput,
  weakChars: string[],
  bigram: string | null,
  room: number,
): string {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = fillTemplate(template, rng, input, weakChars, bigram);
    const cut = candidate.slice(0, room);
    if (coversFocus(cut, weakChars)) return cut;
  }
  return fallbackCovered(rng, weakChars, room);
}

/** Last-resort line: a focus char + a whole corpus word (never a partial
 * word — the quality property forbids letter runs outside the corpus). */
function fallbackCovered(rng: () => number, weakChars: string[], room: number): string {
  if (room < 1) return "";
  const lead =
    weakChars.length > 0
      ? weakChars[Math.floor(rng() * weakChars.length)]
      : DISTRACTOR_SYMBOLS[Math.floor(rng() * DISTRACTOR_SYMBOLS.length)];
  if (room === 1) return lead;
  const fits = CORPUS_WORDS.filter((w) => w.length <= room - 1);
  if (fits.length === 0) return lead; // shorter line: the loop refits the rest
  const word = fits[Math.floor(rng() * fits.length)];
  return `${lead}${word}`;
}

/**
 * Generates one drill set as a Lesson-shaped object (passes `LessonSchema`
 * by construction). Deterministic per (analysis, seed, setIndex).
 */
export function generateDrillSet(input: GeneratorInput): GeneratedSet {
  const { analysis, config, seed, setIndex } = input;
  const weakChars = weakCharsOf(analysis);
  const rng = mulberry32(hashSeed(seed, setIndex, weakChars.join(""), analysis.combos.map((c) => c.pair).join("|")));
  const bigram = weakBigram(analysis, weakChars);
  const level = Math.min(7, Math.max(1, Math.round(input.userLevel)));

  const eligible = TEMPLATES.filter((t) => t.minLevel <= level);
  const lines: string[] = [];
  let length = 0; // total content chars INCLUDING newline separators
  const target = config.setLength;

  while (length < target) {
    const sep = lines.length === 0 ? 0 : 1;
    const room = target - length - sep;
    const template = eligible[Math.floor(rng() * eligible.length)];
    let line = fillTemplate(template, rng, input, weakChars, bigram);
    // Coverage gate: a line without any focus symbol is dead practice —
    // refit (bounded retries + guaranteed fallback) whenever the sampled
    // line missed the focus chars or needs trimming that would drop them.
    if (!coversFocus(line, weakChars) || line.length > room) {
      line = fitCovered(template, rng, input, weakChars, bigram, room);
    }
    lines.push(line);
    length += sep + line.length;
  }

  const focus = weakChars.slice(0, 3).map((c) => CHAR_FAMILIES[c] ?? `'${c}'`);
  const title =
    focus.length === 0
      ? "Free Practice"
      : focus.length === 1
        ? `${focus[0]} Isolation`
        : `${focus.slice(0, -1).join(", ")} & ${focus[focus.length - 1]} Isolation`;

  const lesson = LessonSchema.parse({
    id: `adaptive-${seed.toString(36)}-${setIndex}`,
    level,
    orderIndex: 0,
    title,
    description: `Adaptive drill: weak symbols injected at ×${config.symbolWeight} frequency inside real ${
      config.wordContext === "code_identifiers" ? "identifier" : "word"
    } contexts.`,
    content: lines.join("\n"),
    targetKeys: weakChars,
    tags: ["adaptive", "weakness"],
    source: "builtin",
    createdAt: 0,
  });

  return { lesson, weakChars };
}

/**
 * Builds every set of a drill session up-front (plan §3.4: "build 5 sets
 * from the generator") — each set is deterministic per (analysis, seed,
 * setIndex), so REGENERATE just changes the seed.
 */
export function generateDrillSets(
  input: Omit<GeneratorInput, "setIndex">,
  sets: number,
): GeneratedSet[] {
  return Array.from({ length: sets }, (_, setIndex) =>
    generateDrillSet({ ...input, setIndex }),
  );
}
