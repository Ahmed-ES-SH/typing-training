import { assemble, bankRun, drill, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 5 — Programming Vocabulary (42 lessons).
 * The PRD §6 word list and the wider everyday vocabulary, as word drills
 * first and short phrases second.
 */

export const LEVEL_5_META: LevelMeta = {
  level: 5,
  name: "Programming Vocabulary",
  tagline: "VOCABULARY",
};

interface PairSpec {
  words: [string, string] | [string, string, string];
  phrases: string[];
}

function pairLesson(spec: PairSpec): {
  title: string; description: string; content: string; tags: string[];
} {
  const words = spec.words;
  return {
    title: `Words: ${words.join(", ")}`,
    description: `The vocabulary core: ${words.join(" and ")} — drilled solo, paired, then in live phrases.`,
    content: joinLines(
      ...words.map((w) => drill(w, 5, 1)),
      rep(words.join(" "), 3),
      bankRun([...words, ...words], 0, 6),
      ...spec.phrases.map((p) => rep(p, 2)),
    ),
    tags: ["vocabulary"],
  };
}

export function buildLevel5(): Lesson[] {
  const pairs: PairSpec[] = [
    { words: ["function", "return"], phrases: ["function run() { return x; }", "return the value now"] },
    { words: ["variable", "value"], phrases: ["the variable holds a value", "value = variable + 1"] },
    { words: ["class", "object"], phrases: ["class makes an object", "object of the base class"] },
    { words: ["interface", "type"], phrases: ["interface defines a type", "type of the first interface"] },
    { words: ["array", "index"], phrases: ["array index starts at zero", "index into the array"] },
    { words: ["string", "char"], phrases: ["a string is a char array", "char by char the string grows"] },
    { words: ["number", "boolean"], phrases: ["number or boolean type", "boolean flags the number"] },
    { words: ["const", "let"], phrases: ["const wins over let", "let it be const instead"] },
    { words: ["async", "await"], phrases: ["async function call", "await the async result"] },
    { words: ["import", "export"], phrases: ["import what you export", "export the import list"] },
    { words: ["if", "else"], phrases: ["if not this then else", "if and else pair up"] },
    { words: ["for", "while"], phrases: ["for now and while later", "while runs for ages"] },
    { words: ["switch", "case", "break"], phrases: ["switch on the case then break", "break after each case"] },
    { words: ["try", "catch", "throw"], phrases: ["try catch and throw again", "throw it to the catch"] },
    { words: ["method", "call"], phrases: ["call the method twice", "method call in a chain"] },
    { words: ["parameter", "argument"], phrases: ["one argument per parameter", "parameter takes the argument"] },
    { words: ["property", "field"], phrases: ["the property is a field", "field property lookup"] },
    { words: ["public", "private"], phrases: ["public here, private there", "private by default public on ask"] },
    { words: ["static", "final"], phrases: ["static final constant", "final static method"] },
    { words: ["extends", "implements"], phrases: ["extends then implements", "implements what it extends"] },
    { words: ["package", "module"], phrases: ["package the module up", "module from that package"] },
    { words: ["default", "void"], phrases: ["void by default", "default case returns void"] },
    { words: ["null", "undefined", "nil"], phrases: ["null or undefined or nil", "undefined is not nil"] },
    { words: ["true", "false"], phrases: ["true or false always", "false until proven true"] },
    { words: ["new", "delete", "free"], phrases: ["new then delete then free", "free what you new"] },
    { words: ["struct", "enum"], phrases: ["struct with an enum", "enum inside the struct"] },
    { words: ["pointer", "reference"], phrases: ["pointer or reference here", "reference the pointer type"] },
    { words: ["map", "filter", "reduce"], phrases: ["map then filter then reduce", "reduce the map filter"] },
    { words: ["push", "pop", "slice"], phrases: ["push pop and slice it", "slice before you push"] },
    { words: ["length", "size", "count"], phrases: ["count the size not length", "length size and count"] },
    { words: ["key", "item", "entry"], phrases: ["each key maps to one entry", "item key and entry"] },
    { words: ["data", "buffer", "stream"], phrases: ["stream the buffer data", "data buffer stream chain"] },
    { words: ["file", "path", "dir"], phrases: ["file path inside the dir", "dir path to the file"] },
    { words: ["server", "client", "host"], phrases: ["client asks the server host", "host the server for the client"] },
    { words: ["request", "response"], phrases: ["request in response out", "response to that request"] },
    { words: ["thread", "task", "lock"], phrases: ["lock the thread task", "task runs on a thread"] },
    { words: ["error", "exception", "fail"], phrases: ["fail fast raise exception", "error handling exception"] },
    { words: ["test", "debug", "assert"], phrases: ["assert in every test", "debug the failing assert"] },
    { words: ["parse", "format", "encode"], phrases: ["parse format and encode", "encode then parse the format"] },
    { words: ["user", "admin", "token"], phrases: ["admin user token check", "token for the admin user"] },
  ];

  const lessons = pairs.map(pairLesson);
  lessons.push({
    title: "Definitions & Signatures",
    description:
      "Vocabulary in real signatures — functions, types and returns woven together.",
    content: joinLines(
      rep("function getValue() { return value; }", 2),
      rep("const setValue = (v) => { value = v; };", 2),
      rep("interface User { id: number; }", 2),
      rep("class Parser { parse(text) {} }", 2),
      rep("async function load(path) {}", 2),
    ),
    tags: ["vocabulary", "review"],
  });
  lessons.push({
    title: "Level 5 Vocabulary Review",
    description:
      "The full keyword sweep — every Level 5 word family in one challenge.",
    content: joinLines(
      bankRun(["function", "return", "class", "object", "array", "index"], 0, 6),
      bankRun(["const", "let", "async", "await", "import", "export"], 0, 6),
      bankRun(["if", "else", "for", "while", "try", "catch"], 0, 6),
      bankRun(["string", "number", "boolean", "type", "interface"], 0, 5),
      rep("true false null undefined void", 2),
      rep("map filter reduce push pop slice", 2),
    ),
    tags: ["vocabulary", "review"],
  });

  return assemble(5, lessons);
}
