import { assemble, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 7 — Real Code (22 lessons).
 * Progressively realistic snippets in JavaScript, TypeScript, HTML, CSS,
 * SQL, JSON, Bash and Git (PRD §6), each tagged with its language.
 */

export const LEVEL_7_META: LevelMeta = {
  level: 7,
  name: "Real Code Across the Stack",
  tagline: "APEX",
};

interface CodeSpec {
  title: string;
  description: string;
  lines: string[];
  language: string;
}

function code(spec: CodeSpec): {
  title: string; description: string; content: string; tags: string[];
} {
  return {
    title: spec.title,
    description: spec.description,
    content: joinLines(...spec.lines),
    tags: ["code", spec.language],
  };
}

export function buildLevel7(): Lesson[] {
  return assemble(7, [
    code({
      title: "JavaScript: Array Utilities",
      description: "A tiny utility belt — map, filter and reduce over real data.",
      language: "javascript",
      lines: [
        "const sum = (nums) => nums.reduce((a, b) => a + b, 0);",
        "const uniq = (xs) => [...new Set(xs)];",
        "const top = (xs, n) => xs.slice(0, n);",
        "",
        rep("sum([1, 2, 3]); // 6", 2),
      ],
    }),
    code({
      title: "JavaScript: Async Fetch",
      description: "The fetch-then-json dance with error handling, straight from daily work.",
      language: "javascript",
      lines: [
        "async function getUser(id) {",
        "  try {",
        "    const res = await fetch(`/api/users/${id}`);",
        "    if (!res.ok) throw new Error('not found');",
        "    return await res.json();",
        "  } catch (err) {",
        "    console.error(err.message);",
        "    return null;",
        "  }",
        "}",
      ],
    }),
    code({
      title: "JavaScript: DOM Script",
      description: "Query, listen, update — the browser triad in ten lines.",
      language: "javascript",
      lines: [
        "const btn = document.querySelector('#submit');",
        "const list = document.getElementById('todos');",
        "",
        "btn.addEventListener('click', () => {",
        "  const li = document.createElement('li');",
        "  li.textContent = 'done';",
        "  list.appendChild(li);",
        "});",
      ],
    }),
    code({
      title: "JavaScript: Debounce Utility",
      description: "A classic interview utility — closures, timers and clean returns.",
      language: "javascript",
      lines: [
        "function debounce(fn, wait = 200) {",
        "  let timer = null;",
        "  return (...args) => {",
        "    clearTimeout(timer);",
        "    timer = setTimeout(() => fn(...args), wait);",
        "  };",
        "}",
      ],
    }),
    code({
      title: "TypeScript: Typed Interfaces",
      description: "An interface, a typed function and a default — TS in miniature.",
      language: "typescript",
      lines: [
        "interface User {",
        "  id: number;",
        "  name: string;",
        "  tags?: string[];",
        "}",
        "",
        "function findUser(users: User[], id: number): User | null {",
        "  return users.find((u) => u.id === id) ?? null;",
        "}",
      ],
    }),
    code({
      title: "TypeScript: Generics",
      description: "Generic functions and constraints — <T> doing real work.",
      language: "typescript",
      lines: [
        "function firstOf<T>(items: T[]): T | undefined {",
        "  return items.length > 0 ? items[0] : undefined;",
        "}",
        "",
        "type Result<T> = { ok: true; value: T } | { ok: false };",
        "const wrap = <T,>(value: T): Result<T> => ({ ok: true, value });",
      ],
    }),
    code({
      title: "TypeScript: Type Guards",
      description: "Narrowing with predicates — typeof, in and custom guards.",
      language: "typescript",
      lines: [
        "type Shape = Circle | Rect;",
        "interface Circle { kind: 'circle'; r: number }",
        "interface Rect { kind: 'rect'; w: number; h: number }",
        "",
        "function isCircle(s: Shape): s is Circle {",
        "  return s.kind === 'circle';",
        "}",
      ],
    }),
    code({
      title: "TypeScript: Config Object",
      description: "Satisfies, readonly and Record — typing a real config block.",
      language: "typescript",
      lines: [
        "type Options = {",
        "  readonly retries: number;",
        "  readonly baseUrl: string;",
        "  readonly headers: Record<string, string>;",
        "};",
        "",
        "const defaults = {",
        "  retries: 3,",
        "  baseUrl: 'https://api.local',",
        "  headers: { 'x-client': 'tk' },",
        "} satisfies Options;",
      ],
    }),
    code({
      title: "HTML: Page Skeleton",
      description: "A semantic page frame — head, header, main and footer.",
      language: "html",
      lines: [
        "<!DOCTYPE html>",
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><title>Home</title></head>',
        "  <body>",
        '    <header><h1>TypeKernel</h1></header>',
        '    <main id="app"></main>',
        "    <footer><p>offline</p></footer>",
        "  </body>",
        "</html>",
      ],
    }),
    code({
      title: "HTML: Form Elements",
      description: "Inputs, labels and buttons — forms typed pixel-perfect.",
      language: "html",
      lines: [
        '<form action="/api/login" method="post">',
        '  <label for="user">Name</label>',
        '  <input id="user" name="user" type="text" required />',
        '  <label for="pass">Password</label>',
        '  <input id="pass" name="pass" type="password" />',
        '  <button type="submit">Sign in</button>',
        "</form>",
      ],
    }),
    code({
      title: "HTML: Table Markup",
      description: "thead, tbody, tr and td — table bones in semantic order.",
      language: "html",
      lines: [
        "<table>",
        "  <thead>",
        "    <tr><th>Key</th><th>Value</th></tr>",
        "  </thead>",
        "  <tbody>",
        '    <tr><td>host</td><td>127.0.0.1</td></tr>',
        '    <tr><td>port</td><td>8080</td></tr>',
        "  </tbody>",
        "</table>",
      ],
    }),
    code({
      title: "CSS: Layout Rules",
      description: "Flexbox layout block — selectors, properties and values.",
      language: "css",
      lines: [
        ".layout {",
        "  display: flex;",
        "  flex-direction: column;",
        "  align-items: center;",
        "  gap: 8px;",
        "  max-width: 960px;",
        "  min-height: 100vh;",
        "  margin: 0 auto;",
        "  padding: 16px;",
        "}",
      ],
    }),
    code({
      title: "CSS: Theme Variables",
      description: "Custom properties and calc — a theme block with real tokens.",
      language: "css",
      lines: [
        ":root {",
        "  --color-bg: #0f131c;",
        "  --color-accent: #f97316;",
        "  --space-sm: 8px;",
        "}",
        "",
        ".button {",
        "  background: var(--color-accent);",
        "  padding: var(--space-sm) calc(var(--space-sm) * 2);",
        "}",
        "",
        ".panel {",
        "  border: 1px solid var(--color-bg);",
        "  color: var(--color-accent);",
        "}",
      ],
    }),
    code({
      title: "SQL: Create Table",
      description: "DDL with constraints — CREATE TABLE with keys and defaults.",
      language: "sql",
      lines: [
        "CREATE TABLE lesson_attempts (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  lesson_id TEXT NOT NULL,",
        "  attempt_number INTEGER NOT NULL,",
        "  wpm REAL NOT NULL DEFAULT 0,",
        "  completed INTEGER NOT NULL DEFAULT 0,",
        "  finished_at INTEGER NOT NULL",
        ");",
      ],
    }),
    code({
      title: "SQL: Join Query",
      description: "SELECT with JOIN, WHERE and ORDER BY — the reporting classic.",
      language: "sql",
      lines: [
        "SELECT l.title, p.best_wpm, p.attempt_count",
        "FROM lessons AS l",
        "JOIN lesson_progress AS p ON p.lesson_id = l.id",
        "WHERE p.status = 'completed'",
        "ORDER BY p.best_wpm DESC",
        "LIMIT 10;",
      ],
    }),
    code({
      title: "SQL: Insert & Update",
      description: "Write paths — INSERT INTO and UPDATE ... WHERE in one block.",
      language: "sql",
      lines: [
        "INSERT INTO lesson_progress (lesson_id, status, updated_at)",
        "VALUES ('l1-001', 'available', 0);",
        "",
        "UPDATE lesson_progress",
        "SET status = 'completed', completed_at = 1700000000",
        "WHERE lesson_id = 'l1-001' AND status = 'available';",
      ],
    }),
    code({
      title: "JSON: Config File",
      description: "A nested config document — braces, quotes and commas in harmony.",
      language: "json",
      lines: [
        "{",
        '  "name": "typekernel",',
        '  "version": "2.1.0",',
        '  "build": { "target": "desktop", "minify": true },',
        '  "lessons": { "count": 260, "levels": [1, 2, 3, 4, 5, 6, 7] },',
        '  "offline": true',
        "}",
      ],
    }),
    code({
      title: "JSON: Data Payload",
      description: "Arrays of objects — the API response shape you type and read daily.",
      language: "json",
      lines: [
        "{",
        '  "items": [',
        '    { "id": 1, "title": "home row", "tags": ["basic"] },',
        '    { "id": 2, "title": "symbols", "tags": ["shift", "code"] }',
        "  ],",
        '  "total": 2,',
        '  "ok": true',
        "}",
      ],
    }),
    code({
      title: "Bash: Backup Script",
      description: "A real script — shebang, variables, loop and guard clauses.",
      language: "bash",
      lines: [
        "#!/bin/bash",
        "set -euo pipefail",
        "",
        'SRC="$HOME/projects"',
        'DEST="/backup/$(date +%F)"',
        "",
        'mkdir -p "$DEST"',
        'for dir in "$SRC"/*; do',
        '  cp -r "$dir" "$DEST/" || echo "skip $dir"',
        "done",
      ],
    }),
    code({
      title: "Bash: Pipeline Drill",
      description: "grep, awk and pipes — command chains exactly as typed in a terminal.",
      language: "bash",
      lines: [
        'grep -rn "TODO" src/ | wc -l',
        'ps aux | grep node | awk \'{ print $2 }\'',
        'find . -name "*.test.ts" | xargs wc -l',
        'du -sh * | sort -rh | head -n 5',
        'curl -s localhost:1420 | jq ".status"',
      ],
    }),
    code({
      title: "Git: Daily Workflow",
      description: "The everyday loop — status, add, commit, rebase and push.",
      language: "git",
      lines: [
        "git status && git diff --stat",
        "git add -A",
        'git commit -m "feat: unlock rule + lessons screen"',
        "git fetch origin",
        "git rebase origin/main",
        "git push --force-with-lease",
      ],
    }),
    code({
      title: "Git: Fix & Inspect",
      description: "History surgery — log, show, revert and stash under pressure.",
      language: "git",
      lines: [
        "git log --oneline -10",
        'git show HEAD~1 --name-only',
        "git revert --no-edit abc1234",
        "git stash push -m 'wip: lessons'",
        "git stash pop && git restore --staged .",
      ],
    }),
  ]);
}
