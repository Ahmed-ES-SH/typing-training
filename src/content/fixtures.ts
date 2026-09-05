import { LessonSchema, type Lesson } from "../lib/schemas";

/**
 * FIXTURE LESSONS — development-only (Phase 3).
 *
 * Hand-written stand-ins for the Phase 4 generator pipeline. They let the
 * session screen, engine and persistence path run end-to-end before the
 * 250-lesson curriculum exists. They are NOT part of the shipped curriculum:
 * Phase 4 deletes or demotes this file once real Level 1 lessons are
 * generated and seeded.
 */

const now = 0; // fixture timestamp; real lessons get real created_at in Phase 4

export const FIXTURE_LESSONS: Lesson[] = [
  LessonSchema.parse({
    id: "fixture-l3-014",
    level: 3,
    orderIndex: 14,
    title: "Struct Arrow & Member",
    description: "Pointer member access: ->, ., and (*p). — the design's demo module.",
    content: [
      "ctx->frame_buffer.pixel.alpha = 0xFF;",
      "header->next_block = nullptr;",
      "raw_ptr->allocated_bytes += size;",
    ].join("\n"),
    targetKeys: ["-", ">", "."],
    tags: ["symbols", "pointers"],
    source: "builtin",
    createdAt: now,
  }),
  LessonSchema.parse({
    id: "fixture-l3-015",
    level: 3,
    orderIndex: 15,
    title: "Braces, Brackets & Colons",
    description: "Nested { } [ ] : structures, JSON/map shapes.",
    content: [
      "config = { \"alpha\": [1, 2], \"beta\": [3, 4] };",
      "matrix[row[0]] = { cols[i], cols[j] };",
      "if (state := get(key)) { run(state); }",
    ].join("\n"),
    targetKeys: ["{", "}", "[", "]", ":"],
    tags: ["symbols", "braces"],
    source: "builtin",
    createdAt: now,
  }),
  LessonSchema.parse({
    id: "fixture-l3-016",
    level: 3,
    orderIndex: 16,
    title: "Operators & Pipes",
    description: "Bitwise/arith mix: | & * = + - _ / %.",
    content: [
      "flags = MASK_READ | MASK_WRITE & ~0x0F;",
      "sum += (a * b) - (c / d) % e;",
      "net_price = base_price - discount_amount;",
    ].join("\n"),
    targetKeys: ["|", "&", "*", "=", "+", "-", "_", "/"],
    tags: ["symbols", "operators"],
    source: "builtin",
    createdAt: now,
  }),
];

/** The lesson the session screen auto-starts (fixture default). */
export const DEFAULT_FIXTURE_LESSON = FIXTURE_LESSONS[0];
