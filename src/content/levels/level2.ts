import { assemble, bankLines, bankRun, drill, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 2 — Numbers (35 lessons).
 * Single-digit isolation, row sweeps, combinations, real-world sequences
 * (IDs, dates, versions, IPs, hex) and digit+symbol mixes from the number row.
 */

export const LEVEL_2_META: LevelMeta = {
  level: 2,
  name: "Numbers, Sequences & Number-Row Symbols",
  tagline: "LOGIC",
};

const TWO_DIGIT = [
  "12", "47", "89", "30", "55", "61", "73", "24", "96", "18",
  "42", "85", "09", "63", "77", "51",
];

const THREE_DIGIT = [
  "101", "250", "404", "512", "768", "999", "333", "642", "808", "127",
];

function digitLesson(
  title: string,
  digit: string,
  neighbours: string,
  samples: string[],
): { title: string; description: string; content: string; tags: string[] } {
  return {
    title,
    description: `Isolate the ${digit} key — the top-row stretch every keyboard forgets — then use it inside real numbers.`,
    content: joinLines(
      drill(`${digit} ${digit}`, 6, 2),
      drill(`${digit}${digit} ${digit}${digit}`, 6, 2),
      rep(`${digit}${neighbours} ${neighbours}${digit}`, 3),
      bankRun(samples, 0, samples.length),
    ),
    tags: ["numbers"],
  };
}

export function buildLevel2(): Lesson[] {
  return assemble(2, [
    digitLesson("Digit 1", "1", "2", ["11", "10", "12", "13", "100", "110", "21", "19"]),
    digitLesson("Digit 2", "2", "3", ["22", "20", "23", "25", "200", "220", "32", "27"]),
    digitLesson("Digit 3", "3", "4", ["33", "30", "34", "37", "300", "330", "43", "38"]),
    digitLesson("Digit 4", "4", "5", ["44", "40", "45", "49", "400", "440", "54", "46"]),
    digitLesson("Digit 5", "5", "6", ["55", "50", "56", "53", "500", "550", "65", "58"]),
    digitLesson("Digit 6", "6", "7", ["66", "60", "67", "69", "600", "660", "76", "64"]),
    digitLesson("Digit 7", "7", "8", ["77", "70", "78", "71", "700", "770", "87", "79"]),
    digitLesson("Digit 8", "8", "9", ["88", "80", "89", "83", "800", "880", "98", "82"]),
    digitLesson("Digit 9", "9", "0", ["99", "90", "09", "91", "900", "990", "19", "95"]),
    digitLesson("Digit 0", "0", "9", ["00", "10", "20", "30", "40", "1000", "2020", "400"]),
    {
      title: "Number Row Sweep Up",
      description: "The full 1234567890 sweep, forward — one glide, no pauses.",
      content: joinLines(
        rep("1234567890", 3),
        rep("1234567890 -=", 2),
        drill("1234567890", 3, 2),
        drill("1234567890", 2, 1),
        rep("0123456789", 2),
      ),
      tags: ["numbers", "row-sweep"],
    },
    {
      title: "Number Row Sweep Down",
      description: "Reverse sweep 0987654321 — the direction your pinky fears most.",
      content: joinLines(
        rep("0987654321", 3),
        rep("0987654321 =-", 2),
        drill("0987654321", 3, 2),
        drill("0987654321", 2, 1),
        rep("9876543210", 2),
      ),
      tags: ["numbers", "row-sweep"],
    },
    {
      title: "Digits & Home Letters",
      description: "Alternating number/letter patterns — the shiftless dip-and-reach rhythm.",
      content: joinLines(
        drill("a1 s2 d3 f4", 4, 2),
        drill("j7 k8 l9 ;0", 4, 2),
        rep("g5 h6 t4 y7", 3),
        bankRun(["a1b2", "c3d4", "e5f6", "g7h8", "i9j0", "k1l2"], 0, 6),
      ),
      tags: ["numbers", "mix"],
    },
    {
      title: "Two-Digit Combinations",
      description: "Common two-digit numbers in rolling groups — the bread and butter of data entry.",
      content: bankLines(TWO_DIGIT, 0, 8, 6) + "\n" + bankRun(TWO_DIGIT, 8, 10),
      tags: ["numbers"],
    },
    {
      title: "Three-Digit Numbers",
      description: "Triplets like 404 and 512 — hold the rhythm across three reaches.",
      content: bankLines(THREE_DIGIT, 0, 5, 6) + "\n" + bankRun(THREE_DIGIT, 5, 10),
      tags: ["numbers"],
    },
    {
      title: "Arithmetic Sequences",
      description: "Counting patterns — evens, fives and squared steps keep all ten digits warm.",
      content: joinLines(
        rep("2 4 6 8 10", 3),
        rep("5 10 15 20 25", 3),
        rep("3 6 9 12 15", 3),
        rep("1 4 9 16 25 36", 3),
        rep("10 20 30 40 50", 2),
      ),
      tags: ["numbers", "sequences"],
    },
    {
      title: "Numeric Identifiers",
      description: "IDs, issue numbers and references — digits embedded in labels.",
      content: joinLines(
        rep("ID 4021 #7712", 3),
        rep("ref 5590 num 0042", 3),
        rep("case 1181 rev 3", 3),
        bankRun(["ID 9901", "bug 1234", "pr 2210", "doc 88", "req 7741", "op 6"], 0, 9),
      ),
      tags: ["numbers", "sequences"],
    },
    {
      title: "Dates",
      description: "ISO dates and hyphenated days — digit runs broken by the minus reach.",
      content: joinLines(
        rep("2026-09-05", 4),
        rep("1999-12-31 2001-01-01", 3),
        rep("2024-02-29 2038-01-19", 3),
        bankRun(["2026-01-15", "2025-07-04", "2023-11-23", "2027-05-30"], 0, 6),
      ),
      tags: ["numbers", "dates"],
    },
    {
      title: "Version Numbers",
      description: "Semantic versions — dotted digit chains that appear in every changelog.",
      content: joinLines(
        rep("2.1.0 1.0.0 0.9.9", 3),
        rep("12.4.33 3.10.2 10.0.1", 3),
        rep("v4.2.1 v0.0.1 v22.1", 3),
        bankRun(["1.2.3", "2.0.0", "0.1.15", "11.9.4", "5.5.5"], 0, 8),
      ),
      tags: ["numbers", "versions"],
    },
    {
      title: "IPv4 Addresses",
      description: "Dotted quads — three dots and twelve digits of pure number-row work.",
      content: joinLines(
        rep("192.168.0.1", 4),
        rep("10.0.0.255 172.16.4.2", 3),
        rep("127.0.0.1 8.8.8.8 1.1.1.1", 3),
        bankRun(["10.1.2.3", "169.254.0.1", "192.168.1.254"], 0, 5),
      ),
      tags: ["numbers", "network"],
    },
    {
      title: "Hexadecimal Values",
      description: "0x-prefixed hex constants — digits plus the A-F range of the keyboard.",
      content: joinLines(
        rep("0xFF2A 0x00 0x7F3C", 3),
        rep("0xDEAD 0xBEEF 0x1234", 3),
        rep("0xA0 0x0F 0xEC 0xB1", 3),
        bankRun(["0xCAFE", "0xF00D", "0xABC", "0x9F"], 0, 6),
      ),
      tags: ["numbers", "hex"],
    },
    {
      title: "Binary & Octal",
      description: "0b and 0o prefixes with raw bit patterns — slow, precise, deliberate.",
      content: joinLines(
        rep("0b1010 0b0110 0b1111", 3),
        rep("0b0001 0b1000 0b1011", 3),
        rep("0o777 0o644 0o755", 3),
        rep("1101 0011 0101 1010", 3),
      ),
      tags: ["numbers", "binary"],
    },
    {
      title: "Ports & Sizes",
      description: "Port numbers and memory sizes — the constants every developer types weekly.",
      content: joinLines(
        rep("8080 443 3000 65535", 3),
        rep("80 22 5432 27017", 3),
        rep("128MB 512KB 64GB 2TB", 3),
        bankRun(["404", "500", "200", "301", "1024", "2048"], 0, 9),
      ),
      tags: ["numbers"],
    },
    {
      title: "Times & Durations",
      description: "Colons between digits — a first taste of shift-key coordination.",
      content: joinLines(
        rep("12:45:30 09:15:00", 3),
        rep("23:59:59 00:00:01", 3),
        rep("90min 3h15m 45s", 3),
        bankRun(["1:30", "11:45", "7:20", "10:05"], 0, 6),
      ),
      tags: ["numbers", "time"],
    },
    {
      title: "Decimals & Percentages",
      description: "Decimal points and percent signs — precision digits for configs and stats.",
      content: joinLines(
        rep("3.14159 99.9% 0.5", 3),
        rep("47.25 0.75 12.5%", 3),
        rep("1.5 0.001 100.0 6.02e23", 3),
        bankRun(["0.25", "2.75", "33.3%", "66.6%"], 0, 6),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Signed Numbers",
      description: "Minus and plus signs with digits — the number row's left flank.",
      content: joinLines(
        rep("-17 +42 -0.5", 3),
        rep("-1 +1 0 -255", 3),
        rep("-100 +200 -32.7", 3),
        bankRun(["-9", "+8", "-64", "+128", "-0.75"], 0, 8),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift Symbols: ! and @",
      description: "Shift-1 and Shift-2 — bang and at-sign enter the stage with their digits.",
      content: joinLines(
        drill("1! 2@", 6, 2),
        rep("!@ !@ !@", 3),
        rep("a1! b2@ c3#", 3),
        bankRun(["hi!", "me@dev", "user1!", "at@2"], 0, 6),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift Symbols: # and $",
      description: "Hash and dollar — Shift-3 and Shift-4 with digits in real patterns.",
      content: joinLines(
        drill("3# 4$", 6, 2),
        rep("#$ $# #$ $#", 3),
        rep("#1 $2 #3 $4", 3),
        bankRun(["#id", "$9.99", "#12", "$100", "#tag4"], 0, 8),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift Symbols: % and ^",
      description: "Percent and caret — the middle of the shift row, rarely typed and easily missed.",
      content: joinLines(
        drill("5% 6^", 6, 2),
        rep("%^ ^% %^", 3),
        rep("5% off 2^8", 3),
        bankRun(["50%", "2^3", "x^2", "9%"], 0, 6),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift Symbols: & and *",
      description: "Ampersand and asterisk — Shift-7 and Shift-8 in bitwise and multiply shapes.",
      content: joinLines(
        drill("7& 8*", 6, 2),
        rep("&* *& &*", 3),
        rep("7& 8* 9(", 3),
        bankRun(["a&b", "2*3", "&7", "*8", "x*y"], 0, 8),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift Symbols: ( and )",
      description: "The parenthesis pair lives on 9 and 0 — learn them as one motion.",
      content: joinLines(
        drill("9( 0)", 6, 2),
        rep("() () ()", 3),
        rep("(9) (0) 9( 0)", 3),
        bankRun(["(1)", "(22)", "(0)", "9)"], 0, 6),
      ),
      tags: ["numbers", "symbols"],
    },
    {
      title: "Shift-Number Row Mix",
      description: "The whole shifted number row in one drill — !@#$%^&*() at full length.",
      content: joinLines(
        rep("!@#$%^&*()", 4),
        rep("(){}[]!@#$%", 3),
        rep("1! 2@ 3# 4$ 5%", 3),
        rep("6^ 7& 8* 9( 0)", 3),
        drill("!@#$%", 4, 2),
      ),
      tags: ["numbers", "symbols", "shift"],
    },
    {
      title: "Phone-Style Sequences",
      description: "Phone numbers with hyphens and area codes — digits under real-world pressure.",
      content: joinLines(
        rep("555-0142 555-9831", 3),
        rep("(415) 555-2671", 3),
        rep("(212) 555-0198 (617) 555-3241", 3),
        bankRun(["555-0100", "555-1234", "(999) 555-0000"], 0, 5),
      ),
      tags: ["numbers", "sequences"],
    },
    {
      title: "Mixed Numeric Review",
      description: "Versions, IPs, hex and dates interleaved — everything numeric, one pass.",
      content: joinLines(
        bankRun(["2.1.0", "192.168.0.1", "0xFF2A", "2026-09-05", "404", "12:45:30"], 0, 6),
        bankRun(["0.9.9", "10.0.0.255", "0xDEAD", "1999-12-31", "512", "23:59:59"], 0, 6),
        rep("1 2 3 4 5 6 7 8 9 0", 2),
        rep("1234567890 0987654321", 2),
      ),
      tags: ["numbers", "review"],
    },
    {
      title: "Level 2 Review Challenge",
      description: "The full number gauntlet — digits, sequences and shifted symbols together.",
      content: joinLines(
        rep("1234567890", 2),
        rep("!@#$%^&*()", 2),
        bankRun(TWO_DIGIT, 0, 8),
        bankRun(THREE_DIGIT, 2, 6),
        rep("192.168.0.1 0xFF2A 2.1.0", 2),
        rep("2026-09-05 12:45:30 -17 +42", 2),
        rep("50% 2^8 a&b 2*3 (1)", 2),
      ),
      tags: ["numbers", "review"],
    },
  ]);
}
