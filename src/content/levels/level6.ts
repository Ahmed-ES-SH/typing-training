import { assemble, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 6 — Programming Syntax Patterns (37 lessons).
 * Real statement shapes: control flow, declarations, access chains,
 * async patterns and literals.
 */

export const LEVEL_6_META: LevelMeta = {
  level: 6,
  name: "Programming Syntax Patterns",
  tagline: "STRUCTURES",
};

function pattern(
  title: string,
  description: string,
  lines: string[],
  tags: string[],
): { title: string; description: string; content: string; tags: string[] } {
  return {
    title,
    description,
    content: joinLines(...lines.map((line) => rep(line, 3))),
    tags,
  };
}

export function buildLevel6(): Lesson[] {
  return assemble(6, [
    pattern("If Statement", "The gate of all logic: if (...) { ... } typed to a metronome.", [
      "if (ready) { start(); }",
      "if (count > 0) { use(count); }",
      "if (ok) { done = true; }",
    ], ["syntax", "control-flow"]),
    pattern("If / Else", "Both branches of the fork — if and else in one motion.", [
      "if (hit) { score += 1; } else { miss += 1; }",
      "if (open) { enter(); } else { wait(); }",
      "if (dry) { water(); } else { drain(); }",
    ], ["syntax", "control-flow"]),
    pattern("Else-If Chains", "Three-way decisions — else if ladders without hesitation.", [
      "if (a > b) { max = a; }",
      "else if (a < b) { max = b; }",
      "else { max = 0; }",
    ], ["syntax", "control-flow"]),
    pattern("For Loop", "for (let i = 0; i < n; i++) — the most-typed line in programming.", [
      "for (let i = 0; i < n; i++) {",
      "  sum += items[i];",
      "  total += i;",
      "}",
    ], ["syntax", "loops"]),
    pattern("For...Of / For...In", "Modern loops over collections — for (const x of list).", [
      "for (const item of items) { keep(item); }",
      "for (const key in map) { show(key); }",
      "for (const row of rows) draw(row);",
    ], ["syntax", "loops"]),
    pattern("While Loop", "while (alive) { tick(); } — the loop that watches a condition.", [
      "while (alive) { tick(); }",
      "while (queue.length > 0) { work(); }",
      "while (attempts < max) retry();",
    ], ["syntax", "loops"]),
    pattern("Break & Continue", "Early exits — break, continue and do...while control flow.", [
      "do { step(); } while (more);",
      "if (bad) continue;",
      "if (found) break;",
    ], ["syntax", "loops"]),
    pattern("Function Declarations", "function example() {} — declaration anatomy at speed.", [
      "function example() { return 1; }",
      "function greet(name) { return `hi ${name}`; }",
      "function run(task, times) {}",
    ], ["syntax", "functions"]),
    pattern("Functions With Returns", "Parameters in, values out — the full signature shape.", [
      "function add(a, b) { return a + b; }",
      "function clamp(v, lo, hi) { return v; }",
      "function isEmpty(list) { return len == 0; }",
    ], ["syntax", "functions"]),
    pattern("Arrow Functions", "const add = (a, b) => a + b; — the fat arrow and its bodies.", [
      "const add = (a, b) => a + b;",
      "const square = (x) => x * x;",
      "const noop = () => {};",
    ], ["syntax", "functions"]),
    pattern("Arrow Callbacks", "Arrows as callbacks — map, filter and event handlers.", [
      "nums.map((n) => n * 2)",
      "list.filter((x) => x.ok)",
      "btn.onClick = (e) => save(e);",
    ], ["syntax", "functions"]),
    pattern("Const Assignments", "const value = 42; — binding names to values, permanently.", [
      "const value = 42;",
      "const name = 'kernel';",
      "const limit = 2 * 1024;",
    ], ["syntax", "declarations"]),
    pattern("Let & Reassignment", "let counter = 0; counter += 1; — mutable state, tight loops.", [
      "let counter = 0;",
      "counter += 1; counter -= 2;",
      "let flag = true; flag = !flag;",
    ], ["syntax", "declarations"]),
    pattern("Property Access", "object.property.child — dot chains through real objects.", [
      "user.profile.name = 'Ada';",
      "config.db.pool.max = 10;",
      "return car.engine.speed;",
    ], ["syntax", "access"]),
    pattern("Optional Chaining", "user?.profile?.name ?? 'anon' — safe access chains.", [
      "user?.profile?.name ?? 'anon'",
      "res?.data?.items ?? []",
      "cfg?.retries ?? 3;",
    ], ["syntax", "access"]),
    pattern("Index Access", "array[index] — brackets around computed positions.", [
      "first = list[0];",
      "last = list[len - 1];",
      "cell = grid[row][col];",
    ], ["syntax", "access"]),
    pattern("Array Methods", "map, filter, slice, join — the collection verb row.", [
      "list.map(f).filter(ok)",
      "names.slice(0, 3).join(', ')",
      "items.reduce((a, b) => a + b, 0)",
    ], ["syntax", "collections"]),
    pattern("Map With Callbacks", "items.map((item) => item.id) — the daily-driver chain.", [
      "items.map((item) => item.id)",
      "users.map((u) => u.name).join(', ')",
      "rows.map((r) => r.cells[0])",
    ], ["syntax", "collections"]),
    pattern("Try & Catch", "try { ... } catch (e) { ... } — failure as a first-class path.", [
      "try { load(path); }",
      "catch (e) { log(e); }",
      "try { risky(); } catch { safe(); }",
    ], ["syntax", "errors"]),
    pattern("Throw & Finally", "throw new Error(...), finally — the full error lifecycle.", [
      "throw new Error('bad input');",
      "finally { close(file); }",
      "if (v < 0) throw new RangeError();",
    ], ["syntax", "errors"]),
    pattern("Async Functions", "async function load() { ... } — asynchronous by keyword.", [
      "async function load(path) {",
      "  return fetch(path);",
      "}",
    ], ["syntax", "async"]),
    pattern("Await & Promises", "await fetch(url) — promises awaited in sequence.", [
      "const res = await fetch(url);",
      "const data = await res.json();",
      "await Promise.all([a, b]);",
    ], ["syntax", "async"]),
    pattern("Ternary Expressions", "const x = ok ? 1 : 0 — the question mark decision.", [
      "const x = ok ? 1 : 0;",
      "label = big ? 'max' : 'min';",
      "v = n > 0 ? n : -n;",
    ], ["syntax", "expressions"]),
    pattern("Template Literals", "`sum: ${a + b}` — backticks, dollars and braces together.", [
      "const s = `sum: ${a + b}`;",
      "msg = `hi ${user.name}!`;",
      "url = `/api/${id}/items`;",
    ], ["syntax", "expressions"]),
    pattern("Switch Statements", "switch (x) { case 1: break; default: } — the ladder block.", [
      "switch (mode) {",
      "  case 'on': start(); break;",
      "  default: stop();",
      "}",
    ], ["syntax", "control-flow"]),
    pattern("Class Declarations", "class User { constructor() {} } — classes with bodies.", [
      "class User {",
      "  constructor(name) { this.name = name; }",
      "}",
    ], ["syntax", "oop"]),
    pattern("Class Methods & This", "this.value = v; — methods bound to their instance.", [
      "get name() { return this._name; }",
      "set name(v) { this._name = v; }",
      "update() { this.count += 1; }",
    ], ["syntax", "oop"]),
    pattern("Inheritance", "class Admin extends User { super(name); } — extends and super.", [
      "class Admin extends User {",
      "  constructor(name) { super(name); }",
      "}",
    ], ["syntax", "oop"]),
    pattern("Object Literals", "{ key: value, ok: true } — object literals on one breath.", [
      "const point = { x: 1, y: 2 };",
      "const opts = { retries: 3, ok: true };",
      "const empty = {};",
    ], ["syntax", "literals"]),
    pattern("Nested Object Literals", "Two and three levels deep — braces inside braces.", [
      "const cfg = { db: { host: 'local' } };",
      "const res = { data: { items: [] } };",
      "const app = { net: { port: 8080 } };",
    ], ["syntax", "literals"]),
    pattern("Array Literals & Spread", "[1, 2, 3] and [...a, ...b] — literal arrays and spread.", [
      "const nums = [1, 2, 3];",
      "const all = [...first, ...second];",
      "const copy = [...items, extra];",
    ], ["syntax", "literals"]),
    pattern("Destructuring", "const { id, name } = user; — unpack objects and arrays.", [
      "const { id, name } = user;",
      "const [first, second] = pair;",
      "const { ok = false } = res;",
    ], ["syntax", "declarations"]),
    pattern("Import Statements", "import { useState } from 'react'; — module imports.", [
      "import { useState } from 'react';",
      "import * as path from 'path';",
      "import config from './config.json';",
    ], ["syntax", "modules"]),
    pattern("Export Statements", "export function / export default — the module's public face.", [
      "export function main() {}",
      "export const version = '2.1.0';",
      "export default class App {}",
    ], ["syntax", "modules"]),
    pattern("Logical & Comparison Ops", "=== !== && || — the four symbols of every condition.", [
      "if (a === b && c !== d) { go(); }",
      "ok = a > 0 || b < 10;",
      "done = !failed && ready == true;",
    ], ["syntax", "operators"]),
    pattern("JSON Structures", "Full JSON objects — braces, quotes, colons, arrays and commas.", [
      '{"name": "core", "ver": 2,',
      ' "tags": ["a", "b"],',
      ' "meta": {"ok": true, "n": 3}}',
    ], ["syntax", "literals"]),
    pattern("Level 6 Syntax Review", "One of everything — the complete statement buffet.", [
      "if (ok) { for (const x of xs) { use(x); } }",
      "const f = async (v) => await load(v);",
      "try { emit({ id: 1, tags: [2] }); } catch (e) {}",
      "const { a, b } = c > d ? p : q;",
    ], ["syntax", "review"]),
  ]);
}
