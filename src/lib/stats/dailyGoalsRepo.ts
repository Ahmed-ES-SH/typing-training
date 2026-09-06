import { eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../db/client";
import { dailyGoals } from "../db/schema";

/**
 * Daily-goals repository (Phase 8 plan §3.1, PRD §18).
 *
 * Model (plan §2 "Goal model"): per-day goals are stored ONCE, not as
 * per-date rows — the `daily_goals` row keyed `date = 'default'` holds
 * `minutes/lessons/chars` (0 = goal disabled). Per-date rows are written
 * only as *overrides* of those defaults.
 *
 * A missing default row reads as the §18 built-in defaults (15 min / 3
 * lessons / 500 chars) WITHOUT writing — Phase 5 never seeded this table,
 * so this is a data-only move: no migration v4 was needed.
 */

export const DEFAULT_GOAL_DATE = "default";

/** §18 built-in defaults (also the pre-Phase-8 display values). */
export const DEFAULT_GOAL_VALUES = {
  minutesGoal: 15,
  lessonsGoal: 3,
  charsGoal: 500,
} as const;

/** Plan §2 "Goal editing": Zod bounds for the Settings inputs. */
export const DailyGoalBoundsSchema = z.object({
  date: z.union([z.literal("default"), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date")]),
  minutesGoal: z.number().int().min(0).max(480),
  lessonsGoal: z.number().int().min(0).max(100),
  charsGoal: z.number().int().min(0).max(100_000),
});
export type DailyGoalValues = Pick<
  z.infer<typeof DailyGoalBoundsSchema>,
  "minutesGoal" | "lessonsGoal" | "charsGoal"
>;

/** Value columns without the row key (read-back validation). */
const GoalValuesSchema = DailyGoalBoundsSchema.pick({
  minutesGoal: true,
  lessonsGoal: true,
  charsGoal: true,
});

const DateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date");

function toValues(row: {
  minutesGoal: number;
  lessonsGoal: number;
  charsGoal: number;
}): DailyGoalValues {
  return GoalValuesSchema.parse(row);
}

/** Single-row upsert shared by the default and override writers. */
async function upsertGoalRow(valid: z.infer<typeof DailyGoalBoundsSchema>): Promise<void> {
  const db = await getDb();
  await db
    .insert(dailyGoals)
    .values(valid)
    .onConflictDoUpdate({
      target: dailyGoals.date,
      set: {
        minutesGoal: valid.minutesGoal,
        lessonsGoal: valid.lessonsGoal,
        charsGoal: valid.charsGoal,
      },
    });
}

export const dailyGoalsRepo = {
  /** Default goals (the `default` row), or §18 built-ins when unset. */
  async getDefaults(): Promise<DailyGoalValues> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(dailyGoals)
      .where(eq(dailyGoals.date, DEFAULT_GOAL_DATE))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_GOAL_VALUES };
    return toValues({
      minutesGoal: Number(row.minutesGoal),
      lessonsGoal: Number(row.lessonsGoal),
      charsGoal: Number(row.charsGoal),
    });
  },

  /** Replaces the default row (Zod bounds enforced before SQL). */
  async setDefaults(values: DailyGoalValues): Promise<DailyGoalValues> {
    const valid = DailyGoalBoundsSchema.parse({
      date: DEFAULT_GOAL_DATE,
      ...values,
    });
    await upsertGoalRow(valid);
    return toValues(valid);
  },

  /** Per-date override, or null when the date follows the defaults. */
  async getOverride(date: string): Promise<DailyGoalValues | null> {
    DateKeySchema.parse(date);
    const db = await getDb();
    const rows = await db
      .select()
      .from(dailyGoals)
      .where(eq(dailyGoals.date, date))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toValues({
      minutesGoal: Number(row.minutesGoal),
      lessonsGoal: Number(row.lessonsGoal),
      charsGoal: Number(row.charsGoal),
    });
  },

  /** Writes a per-date override (validated; never touches `default`). */
  async setOverride(date: string, values: DailyGoalValues): Promise<DailyGoalValues> {
    DateKeySchema.parse(date);
    if (date === DEFAULT_GOAL_DATE) {
      throw new Error('use setDefaults() for the "default" row');
    }
    const valid = DailyGoalBoundsSchema.parse({ date, ...values });
    await upsertGoalRow(valid);
    return toValues(valid);
  },

  /** Drops a per-date override (the date falls back to the defaults). */
  async clearOverride(date: string): Promise<void> {
    DateKeySchema.parse(date);
    if (date === DEFAULT_GOAL_DATE) {
      throw new Error('the "default" row cannot be cleared, only replaced');
    }
    const db = await getDb();
    await db.delete(dailyGoals).where(eq(dailyGoals.date, date));
  },

  /** Effective goals for a date: override when present, else defaults. */
  async resolveForDate(date: string): Promise<DailyGoalValues> {
    const override = await dailyGoalsRepo.getOverride(date);
    if (override) return override;
    return dailyGoalsRepo.getDefaults();
  },

  /** All per-date override rows (the `default` row excluded), oldest first. */
  async allOverrides(): Promise<Array<DailyGoalValues & { date: string }>> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(dailyGoals)
      .where(ne(dailyGoals.date, DEFAULT_GOAL_DATE));
    return rows.map((row) => ({
      date: DateKeySchema.parse(row.date),
      ...toValues({
        minutesGoal: Number(row.minutesGoal),
        lessonsGoal: Number(row.lessonsGoal),
        charsGoal: Number(row.charsGoal),
      }),
    }));
  },
};
