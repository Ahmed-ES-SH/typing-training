import { LessonSchema, type Lesson, type DrillConfig } from "../schemas";
import {
  focusKeysOf,
  type WeaknessAnalysis,
} from "./analyzer";

/**
 * Adaptive content generator (PRD §13; Phase 6 plan §3.3).
 *
 * Deterministic given (analysis, seed, setIndex): a mulberry32 PRNG seeded
 * from all three drives every choice, so tests can assert exact properties
 * and the REGENERATE button only needs a new seed for new variety.
 *
 * Composition (plan §2): weak chars are injected at the configured weight
 * (default ×3) inside real code-identifier contexts drawn from a curated
 * corpus — JSON-ish config lines, accessor chains, parameter lists — with
 * the weak bigrams from the analyzer embedded where they fit naturally.
 * Non-weak filler comes from the user's typed history when available.
 */

/** Curated context templates (design's `ctx->frame_buffer` style).
 * `{I}` identifier · `{N}` number · `{W}` weak-char injection slot ·
 * `{B}` weak-bigram slot. Templates are tagged with the minimum curriculum
 * level at which their symbols are realistic (plan §3.3). */
interface Template {
  minLevel: number;
  parts: string[]; // literal segments; markers consume the next slot
}

const TEMPLATES: Template[] = [
  { minLevel: 3, parts: ["{W}", "{I}", ": ", "{I}"] },
  { minLevel: 3, parts: ["{I}", "{B}", " ", "{I}"] },
  { minLevel: 3, parts: ["ctx", "{B}", "{I}_", "{I}", " = ", "{N}"] },
  { minLevel: 3, parts: ["{I}[", "{I}", "]", "{B}", " ", "{N}"] },
  { minLevel: 3, parts: ["{W}", "{I}.", "{I}", " = ", "{I}", "{W}"] },
  { minLevel: 3, parts: ["return {I}", "{W}", "{N}", ";"] },
  { minLevel: 2, parts: ["{I}_", "{I}", " = ", "{N}"] },
  { minLevel: 2, parts: ["{I}(", "{N}", ", ", "{I}_", "{N}", ")"] },
  { minLevel: 1, parts: ["{I}", " ", "{I}", " ", "{N}"] },
  { minLevel: 1, parts: ["{I}_", "{I}"] },
];

/** Filler alphabet for non-weak positions (overridden by typed history). */
const DEFAULT_FILLER = "abcdefghijklmnopqrstuvwxyz_".split("");

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
  /** Chars the user has actually typed (non-weak filler realism). */
  typedChars?: string[];
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

/**
 * Samples one char: every weak char carries `weight`, every filler char
 * weight 1 — so over many samples each weak char appears ~`weight`× as
 * often as any single filler char (the §13 "increases the appearance" rule
 * and the property tests' ratio assertion).
 */
function sampleChar(
  rng: () => number,
  weakChars: string[],
  filler: string[],
  weight: number,
): { char: string; weak: boolean } {
  const totalWeight = weakChars.length * weight + filler.length;
  let roll = rng() * totalWeight;
  for (const weak of weakChars) {
    roll -= weight;
    if (roll < 0) return { char: weak, weak: true };
  }
  const fillerIndex = Math.floor(roll % filler.length);
  return { char: filler[fillerIndex] ?? "x", weak: false };
}

/** Builds an identifier of ~3-8 chars, injecting weak chars at `weight`. */
function sampleIdentifier(
  rng: () => number,
  input: GeneratorInput,
  weakChars: string[],
): string {
  const filler =
    input.config.wordContext === "code_identifiers" && input.typedChars?.length
      ? input.typedChars
      : DEFAULT_FILLER;
  const length = 3 + Math.floor(rng() * 6);
  let id = "";
  for (let i = 0; i < length; i++) {
    // Identifiers start with a letter/underscore, never a digit/symbol.
    if (i === 0) {
      id += filler[Math.floor(rng() * filler.length)] ?? "x";
      continue;
    }
    const sampled = sampleChar(rng, weakChars, filler, input.config.symbolWeight);
    id += sampled.char;
  }
  return id;
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
  // chars / a weak char + neighbor so transitions still get trained.
  if (weakChars.length >= 2) return `${weakChars[0]}${weakChars[1]}`;
  if (weakChars.length === 1) return `${weakChars[0]}_`;
  return null;
}

/** Marker tokenizer — parts may mix literals and markers ("{I}_" etc.). */
const MARKER_SPLIT = /(\{I\}|\{N\}|\{W\}|\{B\})/;

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
        out += sampleIdentifier(rng, input, weakChars);
      } else if (token === "{N}") {
        out += sampleNumber(rng);
      } else if (token === "{W}") {
        // Weak-char slot: weighted sample, biased harder than the base weight.
        const sampled = sampleChar(rng, weakChars, [" "], input.config.symbolWeight + 2);
        out += sampled.weak ? sampled.char : " ";
      } else if (token === "{B}") {
        // Weak-bigram slot: the analyzer's worst combo, or a weak-char pair.
        out += bigram ?? sampleIdentifier(rng, input, weakChars).slice(0, 2);
      } else {
        out += token;
      }
    }
  }
  return out;
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
    if (line.length > room) {
      line = line.slice(0, room); // room 0 -> empty line (bare newline)
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
