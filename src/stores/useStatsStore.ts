import { create } from "zustand";

import { attemptsRepo, rangeStart, statsRepo, type AttemptOverview, type AttemptPoint, type DayBucket, type LevelMean, type StatsRange } from "../lib/db/repositories";
import type { AttemptRow } from "../lib/schemas";

/**
 * Statistics store (Phase 5 plan §3.5) — cached aggregates/chart series per
 * range. Range switches hit the cache; anything that appends attempts calls
 * `invalidate()` so the next read re-queries (§2 "until data changes").
 *
 * The raw history page is NOT cached — §24's ledger is always read live so
 * pagination always reflects the DB.
 */

/** §24: the raw log paginates 50 rows per page. */
export const HISTORY_PAGE_SIZE = 50;

export interface FirstTryRate {
  firstTries: number;
  passed: number;
}

/** Everything the Statistics screen charts, for ONE range. */
export interface RangeData {
  overview: AttemptOverview;
  daily: DayBucket[];
  points: AttemptPoint[];
  perLevelMeans: LevelMean[];
  firstTry: FirstTryRate;
}

export interface HistoryPage {
  rows: AttemptRow[];
  total: number;
  page: number;
  pageSize: number;
  range: StatsRange;
}

interface StatsState {
  range: StatsRange;
  /** The PER LEVEL pill switches the WPM chart's view mode, not the window. */
  perLevelMode: boolean;
  data: Partial<Record<StatsRange, RangeData>>;
  loading: boolean;
  error: string | null;
  history: HistoryPage | null;
  setRange: (range: StatsRange) => void;
  setPerLevelMode: (mode: boolean) => void;
  load: (force?: boolean) => Promise<void>;
  loadHistoryPage: (page?: number) => Promise<void>;
  /** Drops cached range data (call after attempts/demo-seed change). */
  invalidate: () => void;
}

export const useStatsStore = create<StatsState>((set, get) => ({
  range: "30d",
  perLevelMode: false,
  data: {},
  loading: false,
  error: null,
  history: null,

  setRange: (range) => {
    set({ range });
    void get().load();
    void get().loadHistoryPage(0);
  },

  setPerLevelMode: (perLevelMode) => set({ perLevelMode }),

  load: async (force = false) => {
    const { range, data } = get();
    if (!force && data[range]) return; // cached per range (§2)
    set({ loading: true, error: null });
    try {
      const from = rangeStart(range);
      const [overview, daily, points, perLevelMeans, firstTry] = await Promise.all([
        statsRepo.overview(from),
        statsRepo.dailySeries(from),
        statsRepo.attemptPoints(from),
        statsRepo.perLevelMeans(from),
        statsRepo.firstTryPassRate(),
      ]);
      set({
        data: {
          ...get().data,
          [range]: { overview, daily, points, perLevelMeans, firstTry },
        },
        loading: false,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Statistics unavailable",
      });
    }
  },

  loadHistoryPage: async (page) => {
    const { range, history } = get();
    const targetPage = page ?? history?.page ?? 0;
    try {
      const from = rangeStart(range);
      const [total, rows] = await Promise.all([
        attemptsRepo.countAll(from),
        attemptsRepo.page(targetPage, HISTORY_PAGE_SIZE, from),
      ]);
      set({
        history: { rows, total, page: targetPage, pageSize: HISTORY_PAGE_SIZE, range },
        error: null,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "History unavailable",
      });
    }
  },

  invalidate: () => {
    set({ data: {} });
    // The visible range re-queries immediately; other ranges re-query the
    // next time they are selected.
    void get().load(true);
    void get().loadHistoryPage(0);
  },
}));

/** Any producer of new attempt rows (finish pipeline, demo seeder) calls
 * this so persistent data changes drop the aggregate caches. */
export function notifyStatsChanged(): void {
  useStatsStore.getState().invalidate();
}
