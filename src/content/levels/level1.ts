import { assemble, bankLines, bankRun, drill, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 1 — Keyboard Fundamentals (26 lessons).
 * Home row, top row, bottom row, reaches, individual-key isolation,
 * two-key combos, finger anchors, basic words and sequences.
 */

export const LEVEL_1_META: LevelMeta = {
  level: 1,
  name: "Home Row & Core Alphanumerics",
  tagline: "FOUNDATION",
};

const HOME_ROW_WORDS = [
  "dad", "sad", "lad", "fall", "flask", "salad", "ask", "lass", "jak", "alas",
  "asks", "glad", "half", "hall", "flags", "kale",
];

const TOP_ROW_WORDS = [
  "type", "rope", "quite", "power", "quote", "pilot", "writer", "paper",
  "quiet", "route", "upper", "report", "output", "prior", "tower", "purity",
];

const BOTTOM_ROW_WORDS = [
  "zoom", "cab", "van", "amber", "comb", "mania", "bench", "verve",
  "cabin", "maze", "navy", "bronze", "canvas", "nomad", "vacuum", "zinc",
];

const THREE_LETTER_WORDS = [
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
  "how", "man", "new", "now", "old", "see", "two", "way", "who", "its",
];

const FOUR_LETTER_WORDS = [
  "with", "this", "that", "have", "from", "word", "what", "were", "when",
  "work", "your", "call", "used", "make", "like", "just", "over", "such",
  "take", "than", "them", "well", "went", "will", "does", "each", "know",
];

export function buildLevel1(): Lesson[] {
  return assemble(1, [
    {
      title: "The Index Anchors: F & J",
      description:
        "Find the bumps, park your index fingers, and build the home-base rhythm every other key reaches from.",
      content: drill("f j", 6, 2) + "\n" + drill("ff jj", 6, 2) + "\n" + drill("fj fj fj", 5, 2) + "\n" + drill("jf jf jf", 5, 2),
      tags: ["home-row", "anchors"],
    },
    {
      title: "Home Row: D & K",
      description:
        "Middle fingers take D and K — same fingers, one column over, always returning to F and J.",
      content: drill("d k", 6, 2) + "\n" + drill("fd jk", 6, 2) + "\n" + drill("dk dk dk", 5, 2) + "\n" + drill("kd fj dk", 5, 2),
      tags: ["home-row", "anchors"],
    },
    {
      title: "Home Row: S & L",
      description:
        "Ring fingers stretch to S and L. Keep the wrists floating and let the fingers do the reaching.",
      content: drill("s l", 6, 2) + "\n" + drill("sd lk", 6, 2) + "\n" + drill("sl sl sl", 5, 2) + "\n" + drill("asd jkl", 5, 3),
      tags: ["home-row", "anchors"],
    },
    {
      title: "Home Row: A & ;",
      description:
        "Pinky discipline starts here: A and semicolon anchor the outer edges of the home row.",
      content: drill("a ;", 6, 2) + "\n" + drill("as ;l", 6, 2) + "\n" + drill("a; a; a;", 5, 2) + "\n" + drill("asdf jkl;", 5, 3),
      tags: ["home-row", "anchors", "pinky"],
    },
    {
      title: "Full Home Row Runs",
      description:
        "Roll across all eight home keys — asdf jkl; — in both directions without looking down.",
      content: drill("asdf jkl;", 5, 3) + "\n" + drill(";lkj dfas", 4, 2) + "\n" + drill("asdfjkl;", 5, 3) + "\n" + bankRun(HOME_ROW_WORDS, 0, 12),
      tags: ["home-row"],
    },
    {
      title: "Adjacent Home Combos",
      description:
        "Two-key rolls between neighbouring fingers: as df jk l; — the raw material of every word.",
      content: drill("as df jk l;", 5, 3) + "\n" + drill("sa fd kj ;l", 5, 2) + "\n" + drill("ad sf jk kl", 5, 2) + "\n" + drill("das kul fis jak", 4, 2),
      tags: ["home-row", "combos"],
    },
    {
      title: "The G & H Reaches",
      description:
        "Index fingers only: stretch in to G and H, then snap back to F and J without moving the hands.",
      content: drill("g h", 6, 2) + "\n" + drill("fg jh", 6, 2) + "\n" + drill("gh gh gh", 5, 2) + "\n" + drill("fgh jhg gf hj", 4, 3),
      tags: ["home-row", "reaches"],
    },
    {
      title: "Home Row Words",
      description:
        "Real words built only from home-row letters — speed comes from rhythm, not rush.",
      content: bankLines(HOME_ROW_WORDS, 0, 4, 6) + "\n" + bankRun(HOME_ROW_WORDS, 14, 10),
      tags: ["home-row", "words"],
    },
    {
      title: "Top Row Left: Q W E R T",
      description:
        "Reach up with the left hand, then return home. Q is the long stretch — take it slow.",
      content: drill("q w e r t", 5, 2) + "\n" + drill("qw ert", 6, 2) + "\n" + drill("qwer ty", 5, 3) + "\n" + drill("treq wert", 4, 2),
      tags: ["top-row"],
    },
    {
      title: "Top Row Right: Y U I O P",
      description:
        "Right hand reaches up to Y U I O P. P is the pinky stretch — anchor and return every time.",
      content: drill("y u i o p", 5, 2) + "\n" + drill("yui op", 6, 2) + "\n" + drill("yuio p", 5, 3) + "\n" + drill("poiuy piop", 4, 2),
      tags: ["top-row"],
    },
    {
      title: "Top Row Words",
      description:
        "Words that live on the top row — proof that the upward reach is worth drilling.",
      content: bankLines(TOP_ROW_WORDS, 0, 4, 6) + "\n" + bankRun(TOP_ROW_WORDS, 14, 10),
      tags: ["top-row", "words"],
    },
    {
      title: "Cross Reaches: T G Y H",
      description:
        "The four index-finger targets in one drill — the fastest columns you will ever type.",
      content: drill("t g y h", 5, 2) + "\n" + drill("tg yh gt hy", 5, 2) + "\n" + drill("that the ghy", 4, 3) + "\n" + bankRun(["that", "this", "tygh", "hytg", "get", "yet", "grey", "high"], 0, 12),
      tags: ["reaches", "index"],
    },
    {
      title: "Bottom Row Left: Z X C V B",
      description:
        "Drop down with the left hand. B is the awkward one — curl the index down and return home.",
      content: drill("z x c v b", 5, 2) + "\n" + drill("zx cvb", 6, 2) + "\n" + drill("zxcv", 6, 3) + "\n" + drill("vcx bzc xvb", 4, 3),
      tags: ["bottom-row"],
    },
    {
      title: "Bottom Row Right: N M , . /",
      description:
        "Right hand drops down for N and M; the pinky picks up comma, period and slash.",
      content: drill("n m , . /", 5, 2) + "\n" + drill("nm ,. /.", 5, 2) + "\n" + drill("mn , . / /", 4, 3) + "\n" + drill("n,m. n/m.", 4, 2),
      tags: ["bottom-row", "punctuation"],
    },
    {
      title: "Bottom Row Words",
      description:
        "Bottom-row vocabulary — the least-visited keys become the most comfortable ones.",
      content: bankLines(BOTTOM_ROW_WORDS, 0, 4, 6) + "\n" + bankRun(BOTTOM_ROW_WORDS, 14, 10),
      tags: ["bottom-row", "words"],
    },
    {
      title: "Reaches: B & N",
      description:
        "Two of the slowest keys in English: B with the left index, N with the right.",
      content: drill("b n", 6, 2) + "\n" + drill("bn nb vb nm", 5, 2) + "\n" + drill("ban bin bon bun", 4, 2) + "\n" + bankRun(["bean", "bend", "bank", "band", "numb", "noun", "bench", "combo"], 0, 12),
      tags: ["reaches"],
    },
    {
      title: "Isolation: E & I",
      description:
        "The two most common vowels in code and prose, typed by different hands — drill the contrast.",
      content: drill("e i", 6, 2) + "\n" + drill("ei ie ee ii", 5, 2) + "\n" + drill("ede iki ere", 4, 2) + "\n" + bankRun(["see", "tie", "ride", "email", "engine", "unit", "series", "review"], 0, 12),
      tags: ["isolation", "vowels"],
    },
    {
      title: "Adjacent Combos Drill",
      description:
        "Neighbour pairs across all three rows: we, ir, os, al — short hops, long-term muscle memory.",
      content: drill("we ir os al ;p", 5, 2) + "\n" + drill("ew ri so la", 5, 2) + "\n" + drill("was oil rad pot", 4, 3) + "\n" + bankRun(["was", "oil", "pot", "let", "red", "far", "gap", "hay"], 0, 12),
      tags: ["combos"],
    },
    {
      title: "Jump Combos Drill",
      description:
        "Skip-column pairs — a; sl dk jp — forcing each finger to act alone instead of rolling.",
      content: drill("a; sl dk jp", 5, 2) + "\n" + drill("fw gj lo qp", 5, 2) + "\n" + drill("ask fad gap jak", 4, 3) + "\n" + bankRun(["flag", "plus", "jump", "disk", "also", "gasp", "soda", "pupa"], 0, 12),
      tags: ["combos"],
    },
    {
      title: "Finger Anchor Exercises",
      description:
        "One finger at a time, both hands: index, middle, ring, pinky — the classic anchor ladder.",
      content: drill("fg jh", 5, 2) + "\n" + drill("dk sl", 5, 2) + "\n" + drill("fr ju", 4, 2) + "\n" + drill("az ;p", 4, 2) + "\n" + drill("aq pl", 4, 2),
      tags: ["anchors", "fingers"],
    },
    {
      title: "Basic Words I",
      description:
        "The most common three-letter words in English — pure home-and-reach rhythm work.",
      content: bankLines(THREE_LETTER_WORDS, 0, 5, 6) + "\n" + bankRun(THREE_LETTER_WORDS, 20, 10),
      tags: ["words"],
    },
    {
      title: "Basic Words II",
      description:
        "Four-letter workhorses — this, that, with, from — typed thousands of times in real code reviews.",
      content: bankLines(FOUR_LETTER_WORDS, 0, 5, 5) + "\n" + bankRun(FOUR_LETTER_WORDS, 20, 10),
      tags: ["words"],
    },
    {
      title: "Letter Sequences",
      description:
        "Alphabet runs in chunks — forward sequences build the row-to-row hand glide.",
      content: joinLines(
        "abcde fghij klmno",
        "pqrst uvwxy z",
        rep("abc cba", 3),
        rep("def fed", 3),
        rep("ghi ihg", 3),
        rep("jkl lkj", 3),
        rep("mno onm", 3),
        rep("pqr rqp", 3),
      ),
      tags: ["sequences"],
    },
    {
      title: "Sentence Rhythm",
      description:
        "Full sentences with spaces and capitals — typing in phrases instead of letters.",
      content: joinLines(
        rep("the quick brown fox", 2),
        rep("jumps over the lazy dog", 2),
        rep("a quick move won the exam", 2),
        rep("we can fix it by friday", 2),
        bankRun(["do not panic yet", "he has the key", "you did it right"], 0, 3),
      ),
      tags: ["sentences"],
    },
    {
      title: "Apostrophes & Light Caps",
      description:
        "Contractions and single capitals — your first shift-key drills, kept gentle.",
      content: joinLines(
        rep("don't can't won't", 3),
        rep("it's that's here's", 3),
        rep("I am OK today", 3),
        rep("Ann and Bob met", 3),
        rep("Yes, we can fix this", 2),
      ),
      tags: ["shift", "punctuation"],
    },
    {
      title: "Level 1 Review Challenge",
      description:
        "Everything from Level 1 in one timed sweep — rows, reaches, words and rhythm.",
      content: joinLines(
        drill("asdf jkl;", 3, 1),
        drill("qwer tyuiop".slice(0, 11), 2, 1),
        drill("zxcv bnm,./", 2, 1),
        bankRun(HOME_ROW_WORDS, 3, 6),
        bankRun(TOP_ROW_WORDS, 5, 6),
        bankRun(BOTTOM_ROW_WORDS, 7, 6),
        rep("the quick brown fox jumps", 2),
        rep("don't stop; keep the flow", 2),
      ),
      tags: ["review"],
    },
  ]);
}
