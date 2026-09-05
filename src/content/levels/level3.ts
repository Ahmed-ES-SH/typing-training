import { assemble, bankRun, drill, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 3 — Programming Symbols (50 lessons).
 * The §6.1-heavy level: bracket pairs, quotes, operators, shift-number
 * symbols and punctuation — isolation drills, mix drills and
 * symbol-in-identifier-context drills.
 */

export const LEVEL_3_META: LevelMeta = {
  level: 3,
  name: "Programming Symbols, Delimiters & Pointers",
  tagline: "SYMBOLS",
};

function symbolFamily(
  symbol: string,
  mirror: string,
  displayName: string,
  contexts: string[],
  extras: string[],
): { title: string; description: string; content: string; tags: string[] }[] {
  return [
    {
      title: `${displayName}: Isolation`,
      description: `Pure ${symbol}${mirror} drilling — every repetition from the anchor, never from the eyes.`,
      content: joinLines(
        drill(`${symbol} ${mirror}`, 6, 2),
        drill(`${symbol}${mirror} ${symbol}${mirror}`, 5, 2),
        drill(`${symbol}${mirror}${symbol} ${mirror}${symbol}${mirror}`, 4, 2),
        rep(`${symbol} ${mirror} ${symbol}${mirror}`, 3),
      ),
      tags: ["symbols"],
    },
    {
      title: `${displayName}: In Code`,
      description: `${displayName} inside realistic lines — the pair motion applied to actual syntax.`,
      content: joinLines(...contexts.map((line) => rep(line, 2))) + "\n" + bankRun(contexts, 0, contexts.length),
      tags: ["symbols", "context"],
    },
    {
      title: `${displayName}: Mix & Match`,
      description: `${displayName} interleaved with its neighbours ${extras.join(" ")} — no more hesitation between pairs.`,
      content: joinLines(
        rep(`${symbol} ${extras[0]} ${mirror}`, 4),
        rep(`${extras[1]}${symbol}x${mirror}${extras[1]}`, 3),
        bankRun([...contexts, ...contexts], 1, 8),
      ),
      tags: ["symbols", "mix"],
    },
  ];
}

export function buildLevel3(): Lesson[] {
  const specs: Parameters<typeof assemble>[1] = [
    ...symbolFamily("(", ")", "Parentheses ( )", [
      "call(arg); start(x);",
      "if (ready) { run(); }",
      "sum = (a + b) * c;",
      "emit((x), (y));",
    ], ["{", "["]),
    ...symbolFamily("{", "}", "Braces { }", [
      "if (ok) { retry(); }",
      "fn main() { init(); }",
      "map = {a: 1, b: 2};",
      "while (x) { y--; }",
    ], ["(", "["]),
    ...symbolFamily("[", "]", "Square Brackets [ ]", [
      "first = list[0];",
      "matrix[i][j] = 0;",
      "ids = [1, 2, 3];",
      "slot = rows[n-1];",
    ], ["(", "{"]),
    ...symbolFamily("<", ">", "Angle Brackets < >", [
      "if (a < b) { swap(); }",
      "let big = x >= y + 1;",
      "list = new List<T>();",
      "box.innerHTML = <b>hi</b>;",
    ], ["(", "["]),
    {
      title: "Forward Slash /",
      description: "Division, paths and comments — the slash is everywhere in code and URLs.",
      content: joinLines(
        drill("/ / //", 5, 2),
        rep("a / b / c", 3),
        rep("usr/local/bin share", 3),
        rep("https://dev.local/api/v2", 2),
        rep("// TODO: fix /ratio", 3),
        bankRun(["1/2", "3/4", "a/b/c", "/root", "24/7"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Backslash \\",
      description: "Escape sequences and Windows paths — the pinky's least favourite reach.",
      content: joinLines(
        drill("\\ \\\\", 5, 2),
        rep("\\n \\t \\r \\0", 4),
        rep("C:\\Users\\dev\\bin", 3),
        rep("regex: \\d+ \\s* \\w?", 3),
        bankRun(["\\n", "\\t\\t", "a\\b", "\\\\srv"], 0, 8),
      ),
      tags: ["symbols", "escapes"],
    },
    {
      title: "Slash & Backslash Mix",
      description: "/ and \\ side by side — opposite pinkies, opposite directions, zero hesitation.",
      content: joinLines(
        rep("/ \\ / \\", 4),
        rep("a/b c\\d /e\\f", 3),
        rep("nix: /var/log win: C:\\log", 2),
        rep("\\d+/ \\w+\\s*", 3),
        bankRun(["\\n", "/2", "\\\\", "//", "\\t"], 0, 8),
      ),
      tags: ["symbols", "mix"],
    },
    {
      title: "Pipe |",
      description: "Bitwise OR, logical OR and shell pipes — one key, three jobs.",
      content: joinLines(
        drill("| ||", 5, 2),
        rep("a | b", 4),
        rep("cat f | grep x | wc -l", 2),
        rep("if (a || b) { go(); }", 3),
        bankRun(["x|y", "a||b", "| tee", "1|0"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Ampersand &",
      description: "Bitwise AND, logical AND and addresses — & & && && in rhythm.",
      content: joinLines(
        drill("& &&", 5, 2),
        rep("a & b", 4),
        rep("if (ok && done) { save(); }", 3),
        rep("ptr = &buffer[0];", 3),
        bankRun(["x&1", "a&&b", "&var", "1&0"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Pipe & Ampersand Mix",
      description: "| and & together — the bitwise family drill before masks and flags.",
      content: joinLines(
        rep("| & | & | &", 4),
        rep("flags = R | W & MASK;", 3),
        rep("(a && b) || (c & d);", 3),
        rep("1|0 1&1 0|1 0&1", 3),
        bankRun(["|&", "&|", "a|b&c", "&&||"], 0, 6),
      ),
      tags: ["symbols", "mix"],
    },
    {
      title: "Asterisk *",
      description: "Multiply, pointers and imports — the asterisk's triple life.",
      content: joinLines(
        drill("* **", 5, 2),
        rep("a * b * c", 3),
        rep("int *head = &buf[0];", 3),
        rep("import * as fs from 'fs';", 2),
        bankRun(["2*3", "*p", "**x", "a*=2"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Percent %",
      description: "Modulo, format specifiers and percentages — %s %d %n in rhythm.",
      content: joinLines(
        drill("% %%", 5, 2),
        rep("a % b", 4),
        rep('printf("%d items\\n", n);', 2),
        rep("50% of 25% is 12.5%", 3),
        bankRun(["x%2", "%s", "100%", "5%3"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Asterisk & Percent Mix",
      description: "* and % alternate — multiply, modulo, format, repeat.",
      content: joinLines(
        rep("* % * % * %", 4),
        rep("crc = (a * b) % 255;", 3),
        rep('log("%s -> %d%%", k, v);', 2),
        bankRun(["*%", "%*", "a*b%c", "x%2*y"], 0, 6),
      ),
      tags: ["symbols", "mix"],
    },
    {
      title: "Equals =",
      description: "Assignment and comparison — = == === != in one focused drill.",
      content: joinLines(
        drill("= ==", 5, 2),
        rep("x = 1", 4),
        rep("if (a == b) { hit(); }", 3),
        rep("if (a === b && c !== d)", 3),
        rep("total += price; i -= 1;", 2),
        bankRun(["a=1", "a==b", "x+=1", "y-=2", "z*=3"], 0, 8),
      ),
      tags: ["symbols", "operators"],
    },
    {
      title: "Plus +",
      description: "Addition, increment and concat — + ++ += across languages.",
      content: joinLines(
        drill("+ ++", 5, 2),
        rep("a + b + c", 3),
        rep("i++; j += 2; n = n + 1;", 3),
        rep("const full = first + last;", 3),
        bankRun(["+1", "++", "a+b", "x+=y", "s+t"], 0, 8),
      ),
      tags: ["symbols", "operators"],
    },
    {
      title: "Minus -",
      description: "Subtraction, decrement and hyphens — the key that does three jobs.",
      content: joinLines(
        drill("- --", 5, 2),
        rep("a - b", 4),
        rep("i--; n -= 1; d = a - b;", 3),
        rep("well-known-state-driven", 2),
        bankRun(["-1", "--", "a-b", "x-=y", "-5"], 0, 8),
      ),
      tags: ["symbols", "operators"],
    },
    {
      title: "Arithmetic Mix: = + -",
      description: "The core equation trio — assignments and arithmetic without looking.",
      content: joinLines(
        rep("= + - = + - = + -", 3),
        rep("x = a + b - c;", 3),
        rep("sum += i; diff -= j; k = 0;", 3),
        rep("net = gross - tax + bonus;", 2),
        bankRun(["a=b+c", "x=y-z", "n+=1", "m-=2"], 0, 8),
      ),
      tags: ["symbols", "operators"],
    },
    {
      title: "Underscore _",
      description: "snake_case and dunder names — hold Shift and reach for the underscore.",
      content: joinLines(
        drill("_ __", 5, 2),
        rep("snake_case_name", 4),
        rep("__init__ __main__ __name__", 3),
        rep("const max_size = user_id + 1;", 3),
        bankRun(["_id", "a_b", "__x", "first_name"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Colon :",
      description: "Key-value pairs, type annotations and C++ paths — the colon in context.",
      content: joinLines(
        drill(": ::", 5, 2),
        rep("key: value", 4),
        rep("const x: number = 1;", 3),
        rep("std::sync::Arc::new()", 3),
        bankRun(["a:b", "x::y", "::1", "k: v"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Semicolon ;",
      description: "Statement terminators — the home-row pinky earns its keep.",
      content: joinLines(
        drill("; ;;", 5, 2),
        rep("let a = 1;", 4),
        rep("run(); stop(); reset();", 3),
        rep("for (i = 0; i < n; i++) {}", 3),
        bankRun(["a;", "b();", "x=1;", "f();g();"], 0, 8),
      ),
      tags: ["symbols", "pinky"],
    },
    {
      title: "Colon & Semicolon Mix",
      description: ": and ; together — the two home-adjacent symbols that separate code.",
      content: joinLines(
        rep(": ; : ; : ;", 4),
        rep("let id: number = 0;", 3),
        rep("case 1: break; case 2: stop;", 2),
        bankRun(["a:b;", "{k: v};", "x: 1; y: 2;"], 0, 6),
      ),
      tags: ["symbols", "mix"],
    },
    {
      title: "Single Quotes '",
      description: "Apostrophes and char literals — the quote next to Enter.",
      content: joinLines(
        drill("' ''", 5, 2),
        rep("'a' 'b' 'c'", 3),
        rep("char c = 'x';", 3),
        rep("don't can't won't it's", 3),
        bankRun(["'x'", "''", "a'b", "'ok'"], 0, 8),
      ),
      tags: ["symbols", "quotes"],
    },
    {
      title: 'Double Quotes "',
      description: "String literals and JSON — the Shift-enter twin of the single quote.",
      content: joinLines(
        drill('" ""', 5, 2),
        rep('"abc" "def"', 3),
        rep('{"key": "value"}', 3),
        rep('msg = "hello, world";', 3),
        bankRun(['"x"', '""', '"ok"', 'k: "v"'], 0, 8),
      ),
      tags: ["symbols", "quotes"],
    },
    {
      title: "Backticks `",
      description: "Template literals and shell commands — the backtick lives top-left.",
      content: joinLines(
        drill("` ``", 5, 2),
        rep("`` `` ``", 3),
        rep("const s = `sum: ${a + b}`;", 3),
        rep("echo `date` `whoami`", 3),
        bankRun(["`x`", "``", "`ls`", "`${v}`"], 0, 8),
      ),
      tags: ["symbols", "quotes"],
    },
    {
      title: "Quote Trio Mix",
      description: "' \" ` in alternation — strings of every kind, no peeking.",
      content: joinLines(
        rep(`' " \` ' " \` ' " \``, 3),
        rep("it's \"fine\" `now`", 3),
        rep(`{'a': "b", \`c\`: 'd'}`, 2),
        bankRun(["'a'", '"b"', "`c`", "'d\"e`"], 0, 8),
      ),
      tags: ["symbols", "quotes", "mix"],
    },
    {
      title: "Exclamation !",
      description: "Negation and emphasis — bang, double-bang and not-equals.",
      content: joinLines(
        drill("! !!", 5, 2),
        rep("!x !y !!z", 3),
        rep("if (a != b) { warn(); }", 3),
        rep("done = !failed && !stopped;", 2),
        bankRun(["!a", "!=", "!!", "a!==b"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Question Mark ?",
      description: "Ternaries and optional chaining — the question mark's coding careers.",
      content: joinLines(
        drill("? ??", 5, 2),
        rep("a ? b : c", 3),
        rep("const x = ok ? 1 : 0;", 3),
        rep("user?.profile?.name ?? 'anon'", 2),
        bankRun(["a?b:c", "x?.y", "??", "n??0"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "At Sign @",
      description: "Decorators, emails and v-props — the at-sign in three ecosystems.",
      content: joinLines(
        drill("@ @@", 5, 2),
        rep("user@host", 3),
        rep("@Component class App {}", 3),
        rep("mail me at dev@local.host", 2),
        bankRun(["@a", "b@c.d", "@click", "@@x"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Hash & Dollar",
      description: "# comments and ids, $ shell vars and jQuery — the money pair.",
      content: joinLines(
        drill("# $", 5, 2),
        rep("#!/bin/bash", 3),
        rep("echo $HOME $USER", 3),
        rep("$('#root').hide();", 2),
        bankRun(["#id", "$x", "$1", "#end"], 0, 8),
      ),
      tags: ["symbols"],
    },
    {
      title: "Delimiter Families Mix",
      description: "( { [ and their mirrors in rotation — four pairs, one breathing pattern.",
      content: joinLines(
        rep("( { [ ) } ]", 4),
        rep("([{ }]) ([{ }])", 3),
        rep("fn f(x: [T; 2]) -> {a: (1)}", 2),
        bankRun(["()", "{}", "[]", "({[", ")]}"], 0, 8),
      ),
      tags: ["symbols", "mix"],
    },
    {
      title: "Operator Families Mix",
      description: "= + - * / % — the six arithmetic operators in one continuous drill.",
      content: joinLines(
        rep("= + - * / %", 4),
        rep("x = a + b * c / d % e;", 3),
        rep("r1 = (x1 + y1) / (z1 - w1);", 2),
        bankRun(["a+b", "c-d", "e*f", "g/h", "i%j"], 0, 8),
      ),
      tags: ["symbols", "operators", "mix"],
    },
    {
      title: "Shift-Number Row Marathon",
      description: "The entire shifted number row !@#$%^&*() — stamina for the top-left edge.",
      content: joinLines(
        rep("!@#$%^&*()", 4),
        rep(")(*&^%$#@!", 3),
        rep("1! 2@ 3# 4$ 5% 6^", 3),
        rep("7& 8* 9( 0) -_ =+", 3),
        drill("!@#$", 5, 2),
      ),
      tags: ["symbols", "shift", "mix"],
    },
    {
      title: "Punctuation Soup",
      description: ": ; _ ? ! . , — the separator symbols that glue every language together.",
      content: joinLines(
        rep(": ; _ ? ! . ,", 4),
        rep("wait, what? ok: go!", 3),
        rep("name.first; user?.id; _tmp", 3),
        bankRun(["a,b", "c.d", "e;", "f:", "g?", "h!"], 0, 8),
      ),
      tags: ["symbols", "punctuation"],
    },
    {
      title: "Context: Arrows & Members",
      description: "ctx->frame_buffer, a.b.c — pointer member access at full speed.",
      content: joinLines(
        rep("ctx->frame_buffer.pixel", 3),
        rep("node->next->prev = NULL;", 3),
        rep("req.body.user.id = 42;", 3),
        rep("self->count += item->qty;", 2),
        bankRun(["a->b", "x.y.z", "p->q->r", "a.b->c"], 0, 6),
      ),
      tags: ["symbols", "context"],
    },
    {
      title: "Context: Callbacks & Lambdas",
      description: "items.map((item) => ...) — the JS symbol cluster you type daily.",
      content: joinLines(
        rep("items.map((item) => item.id)", 3),
        rep("list.filter((x) => x > 0)", 3),
        rep("users.forEach((u) => save(u));", 2),
        rep("const f = (a, b) => a + b;", 2),
        bankRun(["(x) => x", "(a,b)=>a", "=> {}"], 0, 6),
      ),
      tags: ["symbols", "context"],
    },
    {
      title: "Context: Paths & Generics",
      description: "std::sync::Arc<Mutex<State>> — namespaces, generics and shifts combined.",
      content: joinLines(
        rep("std::sync::Arc<Mutex<State>>", 3),
        rep("Vec<HashMap<K, V>> cache;", 3),
        rep("use crate::store::Cache<T>;", 2),
        rep("Result<Vec<u8>, Error>", 3),
        bankRun(["a::b", "Vec<T>", "x::y::z", "A<B<C>>"], 0, 6),
      ),
      tags: ["symbols", "context"],
    },
    {
      title: "Comparisons & Bounds",
      description: "< > <= >= — four comparison shapes built from one pair of keys.",
      content: joinLines(
        rep("a < b c > d", 3),
        rep("i <= n; j >= 0; k < 10;", 3),
        rep("while (i < size && j >= start)", 2),
        rep("1 < 2 2 > 1 3 >= 3 3 <= 4", 3),
        bankRun(["a<b", "c>d", "x<=y", "p>=q"], 0, 6),
      ),
      tags: ["symbols", "operators"],
    },
    {
      title: "Regex & Character Classes",
      description: "Backslashes, brackets and braces in regex shapes — ^[a-z]{2,4}$.",
      content: joinLines(
        rep("/^[a-z]{2,4}$/", 3),
        rep("\\d{3}-\\d{4} \\s+", 3),
        rep("/[^\\w.-]+@([\\w-]+\\.)+[\\w-]{2,4}/", 1),
        rep("/^(GET|POST)\\s/HTTP", 2),
        bankRun(["\\d+", "[a-z]", "{2,}", "(\\w+)"], 0, 6),
      ),
      tags: ["symbols", "context"],
    },
    {
      title: "Angle Brackets: Tags & Arrows",
      description: "HTML-ish tags and fat arrows — <div>, </p>, => in one drill.",
      content: joinLines(
        rep("<div> <p> </p> </div>", 3),
        rep("<input type=\"text\" />", 2),
        rep("=> => => (x) => x", 3),
        rep("<br/> <hr/> <span>a</span>", 2),
        bankRun(["<b>x</b>", "<a>", "=>", "</i>"], 0, 6),
      ),
      tags: ["symbols", "context"],
    },
    {
      title: "Quotes in Identifiers",
      description: "Quotes and apostrophes inside real words — don't_panic, 'user_id'.",
      content: joinLines(
        rep("don't_panic(\"it's fine\")", 3),
        rep("const tag = 'user_id';", 3),
        rep("msg = don't + \"stop\" + `now`;", 2),
        rep("alias 'ls' to \"list\"", 2),
        bankRun(["'a'", '"b"', "c'd", '"e"f"'], 0, 6),
      ),
      tags: ["symbols", "quotes"],
    },
    {
      title: "Symbol Endurance Drill",
      description: "Every Level 3 symbol in rotation — the two-minute stamina test.",
      content: joinLines(
        rep("( ) { } [ ] < >", 3),
        rep("/ \\ | & * = +", 3),
        rep("- _ : ; ' \" `", 3),
        rep("! ? @ # $ %", 3),
        rep("a->b {k: [1]} <T> f()", 2),
      ),
      tags: ["symbols", "review"],
    },
    {
      title: "Level 3 Final: Structured Literals",
      description: "JSON and struct literals — every Level 3 symbol in one realistic block.",
      content: joinLines(
        rep('{"id": 1, "tags": ["a", "b"]}', 2),
        rep("{count: (n % 10), ok: !done}", 2),
        rep("[[1, 2], [3, 4], {k: (5)}]", 2),
        rep("cfg = {url: 'https://x.y', retries: 3};", 1),
        bankRun(['{"a": [1]}', "()", "[]", "{}", "!x", "a:b"], 0, 8),
      ),
      tags: ["symbols", "review"],
    },
  ];
  return assemble(3, specs);
}
