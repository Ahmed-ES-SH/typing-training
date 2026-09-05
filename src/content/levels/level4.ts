import { assemble, bankLines, bankRun, drill, joinLines, rep } from "../build";
import type { Lesson } from "../../lib/schemas";
import type { LevelMeta } from "../types";

/**
 * Level 4 — Shift & Capitalization (48 lessons).
 * Uppercase letters, shift+symbol combos, capitalized identifiers and the
 * camelCase / PascalCase / snake_case / kebab-case / SCREAMING_SNAKE_CASE
 * families.
 */

export const LEVEL_4_META: LevelMeta = {
  level: 4,
  name: "Shift Combos & Identifier Casing",
  tagline: "CASING",
};

const CAMEL_WORDS = [
  "camelCase", "myVar", "getUserData", "firstItem", "maxCount", "retryLimit",
  "userToken", "nextPage", "isReady", "itemIndex", "logLevel", "tempValue",
  "sendRequest", "parseResult", "oldValue", "totalCount",
];

const PASCAL_WORDS = [
  "PascalCase", "MyComponent", "UserData", "ApiResponse", "HttpClient",
  "ServerError", "TypeWriter", "BaseModel", "JsonParser", "KeyLayout",
  "FormInput", "GridColumn", "AppState", "NodeTree", "EventBus", "TaskQueue",
];

const SNAKE_WORDS = [
  "snake_case", "user_id", "first_name", "max_size", "retry_count",
  "http_error", "access_token", "created_at", "item_index", "log_level",
  "temp_value", "send_mail", "parse_error", "old_value", "total_count",
  "api_version",
];

const KEBAB_WORDS = [
  "kebab-case", "data-url", "aria-label", "font-size", "max-width",
  "box-shadow", "line-height", "z-index", "border-radius", "user-select",
  "pointer-events", "flex-grow", "grid-area", "text-align", "margin-top",
  "padding-left",
];

const SCREAMING_WORDS = [
  "SCREAMING_SNAKE_CASE", "MAX_SIZE", "DEFAULT_VALUE", "API_ENDPOINT",
  "MAX_RETRY_COUNT", "READ_WRITE", "ERROR_CODE", "TIME_OUT", "USER_ROLE",
  "BASE_URL", "LOG_LEVEL", "SESSION_KEY", "TOKEN_SIZE", "BUFFER_LIMIT",
];

const NAMES = [
  "Anna", "Boris", "Clara", "David", "Elena", "Frank", "Grace", "Heidi",
  "Ivan", "Julia", "Kevin", "Laura", "Marta", "Nadia", "Oscar", "Paula",
];

const ACRONYMS = [
  "API", "JSON", "SQL", "URL", "HTTP", "HTML", "CSS", "CLI", "GUI",
  "RAM", "CPU", "SDK", "TCP", "UDP", "SSH", "PNG", "SVG", "UUID",
];

function capsGroup(title: string, group: string, words: string[]): {
  title: string; description: string; content: string; tags: string[];
} {
  return {
    title,
    description: `Uppercase ${group} under the left and right pinky-and-ring shift pattern — hold, strike, release, return.`,
    content: joinLines(
      drill(group.split("").join(" "), 4, 2),
      drill(group.split("").join(""), 5, 2),
      bankRun(words, 0, Math.min(6, words.length)),
    ),
    tags: ["shift", "caps"],
  };
}

export function buildLevel4(): Lesson[] {
  return assemble(4, [
    capsGroup("Capitals: A B C D E F", "ABCDEF", ["Abc", "Def", "Fed", "Cab", "Badge", "Facade"]),
    capsGroup("Capitals: G H I J K L", "GHIJKL", ["Ghi", "Jkl", "Hij", "Gilk", "Hijack", "Glk"]),
    capsGroup("Capitals: M N O P Q R", "MNOPQR", ["Mno", "Pqr", "Rqm", "Pron", "Monk", "Quip"]),
    capsGroup("Capitals: S T U V W X", "STUVWX", ["Stu", "Vwx", "Xut", "Wux", "Vast", "Twix"]),
    {
      title: "Capitals: Y & Z Plus Review",
      description:
        "The rare capitals Y and Z, then a mixed review — the last stretch of the uppercase tour.",
      content: joinLines(
        drill("Y Z", 8, 2),
        drill("YZ", 8, 2),
        rep("Y Z Z Y Y Z", 3),
        bankRun(["Yz", "Zy", "Zany", "Yuzu", "Zippy", "Yawn", "Zesty", "Yodel"], 0, 8),
      ),
      tags: ["shift", "caps"],
    },
    capsGroup("Home-Row Capitals", "ASDFJKL", ["Asdf", "Jkl", "Fall", "Dash", "Salad", "Flask"]),
    {
      title: "Alphabet Sweep: A to Z",
      description: "The full uppercase alphabet in order — one giant shift-key circuit.",
      content: joinLines(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        rep("ABC DEF GHI JKL MNO PQR", 2),
        rep("STU VWX YZ ABC DEF GHI", 2),
        rep("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 2),
      ),
      tags: ["shift", "caps", "review"],
    },
    {
      title: "Alphabet Sweep: Z to A",
      description: "Reverse sweep Z to A — the awkward direction your pinky never practices.",
      content: joinLines(
        "ZYXWVUTSRQPONMLKJIHGFEDCBA",
        rep("ZYX WVU TSR QPO NML KJI", 2),
        rep("HGF EDC BA ZYX WVU TSR", 2),
        rep("ZYXWVUTSRQPONMLKJIHGFEDCBA", 2),
      ),
      tags: ["shift", "caps", "review"],
    },
    {
      title: "Two-Letter Caps",
      description: "IT, OK, US, NO — short uppercase bursts that train quick shift taps.",
      content: joinLines(
        drill("IT OK US NO", 4, 2),
        drill("DO GO UP ON", 4, 2),
        bankRun(["IT", "OK", "US", "UK", "NO", "DO", "GO", "UP", "ON", "TV", "ID", "JS"], 0, 12),
      ),
      tags: ["shift", "caps"],
    },
    {
      title: "Acronyms I",
      description: "The classics — API, JSON, SQL, URL — uppercase fluency for daily chat.",
      content: bankLines(ACRONYMS.slice(0, 12), 0, 4, 6) + "\n" + bankRun(ACRONYMS, 0, 14),
      tags: ["shift", "caps", "acronyms"],
    },
    {
      title: "Acronyms II",
      description: "The systems tier — HTML, CSS, CLI, GUI, RAM, CPU — typed in realistic phrases.",
      content: joinLines(
        bankLines(ACRONYMS.slice(6), 0, 4, 3) + "\n" + bankRun(ACRONYMS.slice(6), 0, 8),
        rep("GUI RAM CPU HTML CSS", 2),
        bankRun(["CPU RAM", "GUI CLI", "SDK PNG", "TCP UDP", "SSH URL"], 0, 5),
      ),
      tags: ["shift", "caps", "acronyms"],
    },
    {
      title: "Capitalized Keywords",
      description: "True, False, None, Null — the capitalized literals of Python land.",
      content: joinLines(
        rep("True False None Null", 3),
        rep("if flag is True: stop()", 2),
        rep("value = None or Null", 3),
        bankRun(["True", "False", "None", "Null", "String", "Number"], 0, 8),
      ),
      tags: ["shift", "caps"],
    },
    {
      title: "Capitalized Names",
      description: "Proper nouns in rotation — every capital from Anna to Paula.",
      content: bankLines(NAMES, 0, 4, 4) + "\n" + bankRun(NAMES, 0, 10),
      tags: ["shift", "caps", "names"],
    },
    {
      title: "Places & Products",
      description: "Linux, Tokyo, Berlin, Kernel — capitals you actually type in docs.",
      content: joinLines(
        rep("Linux Tokyo Berlin Kernel", 3),
        rep("Git Bash Docker Rust Go", 3),
        rep("React Redux Angular Vue", 2),
        bankRun(["Linux", "Kernel", "Docker", "Rust", "Go", "Git"], 0, 8),
      ),
      tags: ["shift", "caps"],
    },
    {
      title: "ALL CAPS Words",
      description: "CONST, MAX, VALUE, EXIT — full-shift endurance with real constants.",
      content: joinLines(
        rep("CONST MAX VALUE EXIT", 3),
        rep("START STOP RESET PAUSE", 3),
        rep("BEGIN END RETRY ABORT", 2),
        bankRun(["ERROR", "READY", "VALID", "FOUND", "EMPTY"], 0, 8),
      ),
      tags: ["shift", "caps"],
    },
    {
      title: "Parenthesized Caps",
      description: "(A) (B) (C) — shift+9, cap, shift+0: the three-stroke parenthesis combo.",
      content: joinLines(
        drill("(A) (B) (C)", 4, 2),
        drill("(F) (J) (D) (K)", 4, 2),
        rep("(X) (Y) (Z) (Q) (W)", 3),
        bankRun(["(A)", "(OK)", "(IT)", "(MAX)", "(N)"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Bracketed Caps",
      description: "[A] [B] [C] — square brackets around capitals, both shifts at once.",
      content: joinLines(
        drill("[A] [B] [C]", 4, 2),
        drill("[F] [J] [D] [K]", 4, 2),
        rep("[X] [Y] [Z] [P] [Q]", 3),
        bankRun(["[A]", "[OK]", "[ID]", "[T]", "[V]"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Braced Caps",
      description: "{A} {B} {C} — brace pairs around capitals for config and enum shapes.",
      content: joinLines(
        drill("{A} {B} {C}", 4, 2),
        drill("{F} {J} {D} {K}", 4, 2),
        rep("{X} {Y} {Z} {M} {N}", 3),
        bankRun(["{A}", "{OK}", "{ID}", "{V}", "{W}"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Angled Caps",
      description: "<A> <B> <C> — angle brackets and capitals, generics meet tags.",
      content: joinLines(
        drill("<A> <B> <C>", 4, 2),
        drill("<F> <J> <D> <K>", 4, 2),
        rep("<X> <Y> <Z> <T> <V>", 3),
        bankRun(["<A>", "<T>", "<OK>", "<V>", "<X>"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Caps & Digits",
      description: "A1 B2 C3 — capital-plus-digit pairs across the shift row.",
      content: joinLines(
        drill("A1 B2 C3 D4", 4, 2),
        drill("E5 F6 G7 H8", 4, 2),
        rep("I9 J0 K1 L2 M3 N4", 3),
        bankRun(["A1", "B2", "C3", "X9", "Y0", "Z4"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Caps & Operators",
      description: "A+B X*Y — capitals on the left of the operator row.",
      content: joinLines(
        drill("A+B X*Y C-D", 4, 2),
        rep("P/Q R%S T&U", 3),
        rep("N=M V|W E^F", 3),
        bankRun(["A+B", "X*Y", "P/Q", "R%S", "N=M"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Caps & Punctuation",
      description: "A; B: C? D! — capitals followed by the separator row.",
      content: joinLines(
        drill("A; B: C? D!", 4, 2),
        rep("E. F, G_ H'", 3),
        rep("OK! No? Yes: Stop; Go.", 3),
        bankRun(["A;", "B:", "C?", "D!", "E.", "F,"], 0, 8),
      ),
      tags: ["shift", "combos"],
    },
    {
      title: "Shift Pair Volley",
      description: "(F) [J] {K} <L> — all four bracket pairs volleyed with capitals.",
      content: joinLines(
        rep("(F) [J] {K} <L>", 3),
        rep("[D] (K) <S> {A}", 3),
        rep("(OK) [NO] {GO} <UP>", 3),
        bankRun(["(A)", "[B]", "{C}", "<D>", "(E)"], 0, 8),
      ),
      tags: ["shift", "combos", "mix"],
    },
    {
      title: "camelCase I",
      description: "The JS naming staple — second-word capitals inside one identifier.",
      content: bankLines(CAMEL_WORDS.slice(0, 12), 0, 4, 4) + "\n" + bankRun(CAMEL_WORDS, 0, 10),
      tags: ["casing", "camelCase"],
    },
    {
      title: "camelCase II",
      description: "camelCase in live code — calls, properties and variables.",
      content: joinLines(
        rep("getUserData(userId);", 3),
        rep("const retryLimit = maxCount;", 2),
        rep("if (isReady) { sendRequest(); }", 2),
        rep("logLevel = parseResult(tempValue);", 2),
        bankRun(CAMEL_WORDS, 8, 8),
      ),
      tags: ["casing", "camelCase"],
    },
    {
      title: "PascalCase I",
      description: "Classes and components — leading capitals, one per word.",
      content: bankLines(PASCAL_WORDS.slice(0, 12), 0, 4, 4) + "\n" + bankRun(PASCAL_WORDS, 0, 10),
      tags: ["casing", "PascalCase"],
    },
    {
      title: "PascalCase II",
      description: "PascalCase in declarations — class, interface and component names.",
      content: joinLines(
        rep("class UserData extends BaseModel {}", 2),
        rep("interface ApiResponse<T> {}", 2),
        rep("const app = new HttpClient();", 2),
        rep("function JsonParser(config) {}", 2),
        bankRun(PASCAL_WORDS, 8, 8),
      ),
      tags: ["casing", "PascalCase"],
    },
    {
      title: "snake_case I",
      description: "Underscore joins, lowercase body — the Python and SQL convention.",
      content: bankLines(SNAKE_WORDS.slice(0, 12), 0, 4, 4) + "\n" + bankRun(SNAKE_WORDS, 0, 10),
      tags: ["casing", "snake_case"],
    },
    {
      title: "snake_case II",
      description: "snake_case in assignments and columns — the shift-less underscore run.",
      content: joinLines(
        rep("const max_size = user_id + 1;", 2),
        rep("SELECT first_name, last_name", 2),
        rep("def send_mail(to_addr, body):", 2),
        rep("error_code = http_error[0]", 2),
        bankRun(SNAKE_WORDS, 8, 8),
      ),
      tags: ["casing", "snake_case"],
    },
    {
      title: "kebab-case I",
      description: "Hyphenated CSS and CLI flags — the minus key between lowercase runs.",
      content: bankLines(KEBAB_WORDS.slice(0, 12), 0, 4, 4) + "\n" + bankRun(KEBAB_WORDS, 0, 10),
      tags: ["casing", "kebab-case"],
    },
    {
      title: "kebab-case II",
      description: "kebab-case in stylesheets and flags — hyphens in live context.",
      content: joinLines(
        rep("font-size: 14px; line-height: 22px;", 2),
        rep("box-shadow: 0 1px 8px rgba(0,0,0,0.4);", 2),
        rep("npm run build --target web --minify", 2),
        rep("border-radius: 4px; text-align: left;", 2),
        bankRun(KEBAB_WORDS, 8, 8),
      ),
      tags: ["casing", "kebab-case"],
    },
    {
      title: "SCREAMING_SNAKE_CASE",
      description: "Constants at full volume — caps plus underscores, hold nothing back.",
      content: bankLines(SCREAMING_WORDS, 0, 3, 4) + "\n" + bankRun(SCREAMING_WORDS, 0, 8),
      tags: ["casing", "constants"],
    },
    {
      title: "SCREAMING in Code",
      description: "Constants in assignments — MAX_RETRY_COUNT = 3 and friends.",
      content: joinLines(
        rep("const MAX_RETRY_COUNT = 3;", 2),
        rep("if (status == ERROR_CODE) {", 2),
        rep("SERVER_PORT = BASE_URL.length", 2),
        rep("USER_ROLE = READ_WRITE | ADMIN", 2),
        bankRun(SCREAMING_WORDS, 4, 8),
      ),
      tags: ["casing", "constants"],
    },
    {
      title: "Casing Convention Mix",
      description: "One identifier, five conventions — feel the shift patterns differ.",
      content: joinLines(
        rep("maxCount MaxCount max_count max-count MAX_COUNT", 2),
        rep("userName UserName user_name user-name USER_NAME", 2),
        rep("retryLimit RetryLimit retry_limit RETRY_LIMIT", 2),
        rep("apiVersion ApiVersion api_version API_VERSION", 2),
      ),
      tags: ["casing", "mix"],
    },
    {
      title: "Class Declarations",
      description: "class UserAccount extends BaseModel — PascalCase under real syntax.",
      content: joinLines(
        rep("class UserAccount extends BaseModel {", 2),
        rep("class HttpServer implements Runnable {", 2),
        rep("class GridColumn extends NodeTree {", 2),
        bankRun(["class TaskQueue", "class AppState", "class EventBus"], 0, 3),
      ),
      tags: ["casing", "PascalCase"],
    },
    {
      title: "Constant Declarations",
      description: "const DEFAULT_VALUE = 42; — SCREAMING names at assignment speed.",
      content: joinLines(
        rep("const DEFAULT_VALUE = 42;", 3),
        rep("const API_ENDPOINT = '/v2/';", 2),
        rep("const SESSION_KEY = 'token';", 2),
        rep("const BUFFER_LIMIT = 1024 * 64;", 2),
        bankRun(["MAX_SIZE = 9", "TIME_OUT = 30", "LOG_LEVEL = 2"], 0, 3),
      ),
      tags: ["casing", "constants"],
    },
    {
      title: "camelCase Functions",
      description: "function getUserById(userId) — verb-first camelCase in signatures.",
      content: joinLines(
        rep("function getUserById(userId) {}", 2),
        rep("function parseJsonValue(text) {}", 2),
        rep("function sendRequest(url, data) {}", 2),
        rep("function isReadyToRetry(count) {}", 2),
        bankRun(["updateState(next)", "loadConfig(file)", "formatDate(now)"], 0, 3),
      ),
      tags: ["casing", "camelCase"],
    },
    {
      title: "Interface & Type Names",
      description: "interface ApiResponse — PascalCase for types in typed languages.",
      content: joinLines(
        rep("interface ApiResponse<T> {", 3),
        rep("type UserRecord = { id: number };", 2),
        rep("interface KeyValueStore<K, V> {", 2),
        rep("type HttpRequest = Request & {}", 2),
        bankRun(["KeyLayout", "TaskQueue", "BaseModel"], 0, 3),
      ),
      tags: ["casing", "PascalCase"],
    },
    {
      title: "Enum Members",
      description: "enum Color { Red, Green, Blue } — PascalCase members and braces.",
      content: joinLines(
        rep("enum Color { Red, Green, Blue }", 2),
        rep("enum Status { Idle, Busy, Done }", 2),
        rep("enum Level { Low, Mid, High, Max }", 2),
        rep("enum Mode { Read, Write, Append }", 2),
        bankRun(["enum Dir { Up, Down }", "enum Day { Mon, Fri }"], 0, 2),
      ),
      tags: ["casing", "PascalCase"],
    },
    {
      title: "DOM & Browser camelCase",
      description: "document.getElementById('root') — the longest camel chains you type.",
      content: joinLines(
        rep("document.getElementById('root')", 2),
        rep("element.addEventListener('click', fn)", 2),
        rep("console.log(`${node.nodeName}`)", 2),
        rep("window.requestAnimationFrame(draw)", 2),
        bankRun(["querySelector('.app')", "classList.add('on')"], 0, 3),
      ),
      tags: ["casing", "camelCase"],
    },
    {
      title: "Rust-Style Identifiers",
      description: "fn new_user(), let mut user_name — snake_case meets Rust keywords.",
      content: joinLines(
        rep("fn new_user(name: &str) -> User {", 2),
        rep("let mut user_name = String::new();", 2),
        rep("impl User { fn is_admin(&self) {} }", 2),
        rep("pub fn max_retry_count() -> u32 {", 2),
        bankRun(["fn parse_config()", "let tmp_value = 0;"], 0, 2),
      ),
      tags: ["casing", "snake_case"],
    },
    {
      title: "SQL CAPS Keywords",
      description: "SELECT user_id FROM users WHERE — shouting keywords over snake_case data.",
      content: joinLines(
        rep("SELECT user_id FROM users;", 2),
        rep("SELECT first_name, last_name FROM people", 2),
        rep("UPDATE users SET user_name = 'ada' WHERE id = 1;", 1),
        rep("DELETE FROM sessions WHERE created_at < NOW();", 1),
        rep("INSERT INTO roles (role_name) VALUES ('admin');", 1),
      ),
      tags: ["casing", "sql"],
    },
    {
      title: "Shift Endurance Drill",
      description: "Long uppercase runs — build the pinky stamina that long constants need.",
      content: joinLines(
        rep("THE QUICK BROWN FOX JUMPS OVER", 2),
        rep("PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS", 1),
        rep("SPHINX OF BLACK QUARTZ JUDGE MY VOW", 1),
        rep("HOW VEXINGLY QUICK DAFT ZEBRAS JUMP", 1),
        rep("AMAZINGLY FEW DISCO THEATERS PROVIDE JUKES", 1),
      ),
      tags: ["shift", "caps", "endurance"],
    },
    {
      title: "Mixed-Case Identifier Review",
      description: "All casing families in one sweep — camel, Pascal, snake, kebab, SCREAMING.",
      content: joinLines(
        bankRun(CAMEL_WORDS, 2, 4),
        bankRun(PASCAL_WORDS, 2, 4),
        bankRun(SNAKE_WORDS, 2, 4),
        bankRun(KEBAB_WORDS, 2, 4),
        bankRun(SCREAMING_WORDS, 2, 3),
        rep("maxCount MaxCount max_count MAX_COUNT", 2),
      ),
      tags: ["casing", "review"],
    },
    {
      title: "Casing in JSON",
      description: '{"userName": "Ada", "maxRetry": 3} — camel keys and values in JSON.',
      content: joinLines(
        rep('{"userName": "Ada", "userId": 42}', 2),
        rep('{"maxRetry": 3, "timeOutMs": 5000}', 2),
        rep('{"baseUrl": "/api/v2", "logLevel": "warn"}', 1),
        rep('{"isActive": true, "lastSeenAt": null}', 1),
        bankRun(['{"a": 1}', '{"keyTwo": "v"}'], 0, 2),
      ),
      tags: ["casing", "json"],
    },
    {
      title: "CSS Selectors & Classes",
      description: ".HeaderClass #main-nav — Pascal selectors over kebab properties.",
      content: joinLines(
        rep(".HeaderClass { font-size: 18px; }", 2),
        rep("#main-nav { background-color: #fff; }", 2),
        rep(".ButtonPrimary:hover { color: red; }", 2),
        rep(".GridRow > .GridCell { padding: 4px; }", 2),
        bankRun([".NavItem", ".FooterBar", "#side-panel"], 0, 3),
      ),
      tags: ["casing", "css"],
    },
    {
      title: "Caps & Symbols Sentence Drill",
      description: "Sentences mixing capitals, quotes and brackets — shift coordination at speed.",
      content: joinLines(
        rep('User "Anna" said: (wait) [OK]!', 2),
        rep('The Config {Debug: True} is Ready;', 2),
        rep("Load <Data> From 'API_V2' Now?", 2),
        rep("Why Not [Try] {Retry} (Again)?", 2),
        bankRun(["Yes!", "No?", "Ok:", "Go;", "Up."], 0, 5),
      ),
      tags: ["shift", "mix"],
    },
    {
      title: "Level 4 Final Review",
      description: "The full casing gauntlet — every shift pattern from Level 4 in one block.",
      content: joinLines(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        bankRun(ACRONYMS, 0, 6),
        bankRun(CAMEL_WORDS, 4, 3),
        bankRun(PASCAL_WORDS, 4, 3),
        bankRun(SNAKE_WORDS, 4, 3),
        bankRun(SCREAMING_WORDS, 4, 2),
        rep("maxCount MaxCount max_count max-count MAX_COUNT", 1),
        rep("(A) [B] {C} <D> A1 B; C? D!", 2),
      ),
      tags: ["shift", "review"],
    },
  ]);
}
