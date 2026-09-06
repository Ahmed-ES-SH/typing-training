import { useEffect, useMemo, useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getLesson } from "../content";
import { StatCard } from "../components/StatCard";
import { KeyHeatmap } from "../components/KeyHeatmap";
import { ConsistencyStrip } from "../components/ConsistencyStrip";
import { analyzeWeaknesses } from "../lib/intelligence/analyzer";
import { getCharAccuracy, type CharAccuracy } from "../lib/intelligence/heatmap";
import { getConsistency, type DayConsistency } from "../lib/stats/dailyService";
import {
  attemptsRepo,
  rangeStart,
  statsRepo,
  type ImprovementBucket,
  type StatsRange,
} from "../lib/db/repositories";
import { cn } from "../lib/cn";
import { useSettingsStore } from "../stores/useSettingsStore";
import { fmt1, fmtDuration, fmtInt, moduleNumber } from "../lib/format";
import { getOverallProgress } from "../lib/stats/progressService";
import {
  HISTORY_PAGE_SIZE,
  useStatsStore,
  type RangeData,
} from "../stores/useStatsStore";
import { evaluateAttempt } from "../lib/curriculum/rules";
import type { PerLevelProgress } from "../lib/stats/progressService";

/**
 * Statistics screen — implemented from
 * `screens/statistics_typekernel/code.html` (Phase 5 plan §3.5). Recharts
 * lives behind this lazy route so the startup chunk stays chart-free (§25).
 *
 * §24 rule: the raw log table shows EVERY attempt (paginated) and CSV export
 * downloads the full filtered set — nothing on this screen reduces history
 * to a best score.
 */

const RANGE_PILLS: { id: StatsRange; label: string }[] = [
  { id: "30d", label: "30 DAYS" },
  { id: "90d", label: "90 DAYS" },
  { id: "all", label: "ALL TIME" },
];

const GRID = "#31353f";
const ORANGE = "#f97316";
const ORANGE_SOFT = "#ffb783";
const MONO_TICK = { fontSize: 10, fontFamily: "JetBrains Mono, monospace", fill: "#e0c0b1" };
const TOOLTIP_STYLE = {
  background: "#0a0e17",
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 11,
} as const;

const dayToTs = (day: string) => new Date(`${day}T12:00:00`).getTime();
const tickDay = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

function resultChip(completed: boolean, wpm: number, accuracy: number) {
  const passed = evaluateAttempt({ completed, accuracy, wpm }) === "PASS";
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 font-code-sm text-[10px] font-bold tracking-wider",
        passed ? "bg-secondary-container/40 text-secondary" : "bg-error-container text-error",
      )}
    >
      {passed ? "PASS" : "FAIL"}
    </span>
  );
}

/* ------------------------------- charts -------------------------------- */

function WpmOverTimeChart({ rangeData }: { rangeData: RangeData }) {
  const data = useMemo(() => {
    const daily = rangeData.daily.map((bucket) => ({
      x: dayToTs(bucket.day),
      daily: bucket.avgWpm,
    }));
    const sessions = rangeData.points.map((point) => ({
      x: point.finishedAt,
      session: point.wpm,
    }));
    return [...daily, ...sessions].sort((a, b) => a.x - b.x);
  }, [rangeData]);

  if (data.length === 0) {
    return <ChartEmpty />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" strokeOpacity={0.5} />
        <XAxis
          dataKey="x"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickDay}
          tick={MONO_TICK}
          tickLine={false}
          stroke={GRID}
        />
        <YAxis tick={MONO_TICK} tickLine={false} stroke={GRID} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(value) => tickDay(Number(value))}
          formatter={(value, name) => [
            `${fmt1(Number(value))} WPM`,
            name === "session" ? "session avg" : "daily avg",
          ]}
        />
        <Line
          type="monotone"
          dataKey="session"
          name="session"
          stroke={ORANGE}
          strokeWidth={1.5}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="daily"
          name="daily"
          stroke={ORANGE_SOFT}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function PerLevelWpmChart({ rangeData }: { rangeData: RangeData }) {
  const data = rangeData.perLevelMeans.map((mean) => ({
    level: `L${mean.level}`,
    avgWpm: mean.avgWpm,
  }));
  if (data.length === 0) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="level" tick={MONO_TICK} tickLine={false} stroke={GRID} />
        <YAxis tick={MONO_TICK} tickLine={false} stroke={GRID} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(249,115,22,0.08)" }}
          formatter={(value) => [`${fmt1(Number(value))} WPM`, "mean wpm"]}
        />
        <Bar dataKey="avgWpm" fill={ORANGE} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AccuracyOverTimeChart({ rangeData }: { rangeData: RangeData }) {
  const data = rangeData.daily.map((bucket) => ({
    x: dayToTs(bucket.day),
    accuracy: bucket.avgAccuracy,
  }));
  if (data.length === 0) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" strokeOpacity={0.5} />
        <XAxis
          dataKey="x"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickDay}
          tick={MONO_TICK}
          tickLine={false}
          stroke={GRID}
        />
        <YAxis domain={[88, 100]} tick={MONO_TICK} tickLine={false} stroke={GRID} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(value) => tickDay(Number(value))}
          formatter={(value) => [`${fmt1(Number(value))}%`, "daily accuracy"]}
        />
        {/* shaded below-gate region */}
        <ReferenceArea y1={88} y2={95} fill="#93000a" fillOpacity={0.18} strokeOpacity={0} />
        <ReferenceLine
          y={95}
          stroke={ORANGE}
          strokeDasharray="5 4"
          label={{
            value: "95% GATE",
            position: "insideBottomRight",
            fill: ORANGE,
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
          }}
        />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke={ORANGE_SOFT}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ImprovementChart({ buckets }: { buckets: ImprovementBucket[] }) {
  if (buckets.length === 0) return <ChartEmpty />;
  const tones = ["#31353f", "#584237", "#d97722", "#f97316", "#ffb783"];
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={buckets} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="bucket" tick={MONO_TICK} tickLine={false} stroke={GRID} />
        <YAxis hide />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(249,115,22,0.08)" }}
          formatter={(value, _name, item) => [
            `${fmt1(Number(value))} WPM`,
            `mean of ${Number(item?.payload?.attempts ?? 0)} attempts`,
          ]}
        />
        <Bar dataKey="avgWpm" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {buckets.map((bucket, index) => (
            <Cell key={bucket.bucket} fill={tones[index % tones.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/40 font-code-sm text-code-sm uppercase tracking-wider text-outline">
      No data in this range
    </div>
  );
}

/* ------------------------------- screen -------------------------------- */

export default function StatisticsScreen() {
  const range = useStatsStore((s) => s.range);
  const perLevelMode = useStatsStore((s) => s.perLevelMode);
  const data = useStatsStore((s) => s.data);
  const lifetime = useStatsStore((s) => s.lifetime);
  const loading = useStatsStore((s) => s.loading);
  const error = useStatsStore((s) => s.error);
  const history = useStatsStore((s) => s.history);
  const setRange = useStatsStore((s) => s.setRange);
  const setPerLevelMode = useStatsStore((s) => s.setPerLevelMode);
  const load = useStatsStore((s) => s.load);
  const loadHistoryPage = useStatsStore((s) => s.loadHistoryPage);

  const [perLevelMastery, setPerLevelMastery] = useState<PerLevelProgress[]>([]);
  const [improvement, setImprovement] = useState<ImprovementBucket[]>([]);
  const [heatmapData, setHeatmapData] = useState<CharAccuracy[]>([]);
  const [consistency, setConsistency] = useState<DayConsistency[] | null>(null);
  const [consistencyError, setConsistencyError] = useState(false);
  const [slowest, setSlowest] = useState<{ key: string; avgLatencyMs: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  const version = useStatsStore((s) => s.version);
  // §20 statistics preference: lifetime window overrides the range pills.
  const heatmapWindowPref = useSettingsStore((s) => s.settings.heatmapWindow);

  useEffect(() => {
    void load();
    void loadHistoryPage(0);
  }, [load, loadHistoryPage]);

  // Key Heatmap (§14): window follows the range pills where meaningful
  // (30d/90d from daily rollups with lifetime fallback; all-time lifetime).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const window = heatmapWindowPref === "lifetime"
          ? "lifetime"
          : range === "30d"
            ? "30d"
            : range === "90d"
              ? "90d"
              : "lifetime";
        const [data, analysis] = await Promise.all([
          getCharAccuracy(window),
          analyzeWeaknesses(),
        ]);
        if (!cancelled) {
          setHeatmapData(data);
          setSlowest(analysis.slowest);
        }
      } catch {
        // DB unavailable — the heatmap shows its no-data cells.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, version, heatmapWindowPref]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [progress, buckets, strip] = await Promise.all([
          getOverallProgress(),
          statsRepo.improvementBuckets(),
          // §18 consistency: 90-day bars from the same per-day sources as
          // the Dashboard strip; failures hide behind the error triad, never
          // a raw exception.
          getConsistency(90),
        ]);
        if (!cancelled) {
          setPerLevelMastery(progress.perLevel);
          setImprovement(buckets);
          setConsistency(strip);
        }
      } catch {
        if (!cancelled) {
          setConsistencyError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeData = data[range];

  const wpmDelta = useMemo(() => {
    if (!rangeData || rangeData.daily.length < 2) return 0;
    const first = rangeData.daily[0].avgWpm;
    const last = rangeData.daily[rangeData.daily.length - 1].avgWpm;
    return last - first;
  }, [rangeData]);

  const bestLessonLabel = useMemo(() => {
    const lessonId = lifetime?.bestWpmLessonId ?? null;
    const lesson = lessonId ? getLesson(lessonId) : null;
    return lesson ? `${moduleNumber(lesson.level, lesson.orderIndex)} drill` : "—";
  }, [lifetime]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await attemptsRepo.allFiltered(rangeStart(range));
      const header = [
        "id", "lesson_id", "attempt_number", "wpm", "accuracy", "error_rate",
        "error_count", "correct_chars", "incorrect_chars", "backspace_count",
        "duration_ms", "completed", "started_at", "finished_at",
      ].join(",");
      const lines = rows.map((row) =>
        [
          row.id, row.lessonId, row.attemptNumber, row.wpm, row.accuracy,
          row.errorRate, row.errorCount, row.correctChars, row.incorrectChars,
          row.backspaceCount, row.durationMs, row.completed ? 1 : 0,
          row.startedAt, row.finishedAt,
        ].join(","),
      );
      const blob = new Blob([`${header}\n${lines.join("\n")}\n`], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `typekernel-attempts-${range}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;
  const attemptOne = improvement.find((b) => b.bucket === "1");
  const attemptFive = improvement.find((b) => b.bucket === "5+");
  const improvementDelta =
    attemptOne && attemptFive ? attemptFive.avgWpm - attemptOne.avgWpm : 0;

  return (
    <main className="flex w-full flex-1 flex-col gap-space-md overflow-y-auto bg-surface p-space-base md:p-space-lg">
      {/* ------------------------------ Hero ------------------------------ */}
      <section className="relative overflow-hidden rounded-xl border border-surface-container-highest/40 bg-gradient-to-br from-surface-container-low to-surface-container-lowest p-space-lg shadow-2xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary-container/10 blur-3xl" />
        <div className="relative flex flex-col gap-space-lg lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-code-sm text-code-sm">
              <span className="rounded bg-surface-container-high px-2 py-0.5 font-bold text-primary">
                PERFORMANCE ANALYTICS // V2.4
              </span>
              <span className="text-outline-variant">•</span>
              <span className="text-on-surface-variant">EVERY KEYSTROKE ACCOUNTED FOR</span>
            </div>
            <h1 className="mt-3 font-display-lg text-4xl font-bold tracking-tight text-on-surface">
              Statistics &amp; Key Telemetry
            </h1>
            <p className="mt-1 max-w-xl font-body-md text-body-md text-on-surface-variant">
              Aggregated from {fmtInt(lifetime?.attempts ?? 0)} all-time local
              attempts. Raw history is never discarded — every chart can be
              traced back to individual sessions.
            </p>

            {/* Range pills */}
            <div className="mt-space-base flex flex-wrap gap-1 rounded-lg bg-surface-container-lowest/70 p-1 font-code-sm text-code-sm">
              {RANGE_PILLS.map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setRange(pill.id)}
                  className={cn(
                    "rounded px-3 py-1 tracking-wider transition-colors",
                    range === pill.id && !perLevelMode
                      ? "bg-primary-container font-bold text-on-primary-container"
                      : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                  )}
                >
                  {pill.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPerLevelMode(!perLevelMode)}
                className={cn(
                  "rounded px-3 py-1 tracking-wider transition-colors",
                  perLevelMode
                    ? "bg-primary-container font-bold text-on-primary-container"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                PER LEVEL
              </button>
            </div>
          </div>

          {/* Aggregate chips — LIFETIME values (plan §3.5) so they can never
              contradict the raw ledger below; only the charts are filtered. */}
          <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
            <StatCard
              icon="speed"
              label="Best WPM (all-time)"
              value={fmt1(lifetime?.bestWpm ?? 0)}
              note={bestLessonLabel}
            />
            <StatCard
              icon="verified"
              label="Avg Accuracy (all-time)"
              value={fmt1(lifetime?.avgAccuracy ?? 0)}
              unit="%"
            />
            <StatCard
              icon="history"
              label="Total Attempts (all-time)"
              value={fmtInt(lifetime?.attempts ?? 0)}
            />
            <StatCard
              icon="schedule"
              label="Trained (all-time)"
              value={fmtDuration(lifetime?.totalDurationMs ?? 0)}
            />
          </div>
        </div>
      </section>

      {error !== null && (
        <div className="rounded-lg border border-error/40 bg-error-container/40 px-space-base py-2 font-code-sm text-code-sm text-error">
          {error}
        </div>
      )}
      {loading && rangeData === undefined && (
        <div className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-lg text-center font-code-sm text-code-sm uppercase tracking-widest text-outline">
          Loading telemetry…
        </div>
      )}

      {rangeData && (
        <>
          {/* ------------------------- Charts row ------------------------- */}
          <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
            <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary-container">
                    show_chart
                  </span>
                  WPM Over Time
                </h3>
                <span className="flex items-center gap-3 font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full bg-primary-container" /> session avg
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0 w-3 border-t-2 border-dashed border-secondary" /> daily avg
                  </span>
                </span>
              </div>
              {perLevelMode ? (
                <PerLevelWpmChart rangeData={rangeData} />
              ) : (
                <WpmOverTimeChart rangeData={rangeData} />
              )}
              <div className="mt-2 flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                <span>{range === "30d" ? "30-day delta" : range === "90d" ? "90-day delta" : "all-time trend"}</span>
                <span className={cn("font-bold", wpmDelta >= 0 ? "text-primary" : "text-error")}>
                  ▲ {wpmDelta >= 0 ? "+" : ""}{fmt1(wpmDelta)} WPM
                </span>
              </div>
            </section>

            <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary-container">
                    verified
                  </span>
                  Accuracy Over Time
                </h3>
                <span className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                  unlock line: 95%
                </span>
              </div>
              <AccuracyOverTimeChart rangeData={rangeData} />
              <div className="mt-2 flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                <span>Pass-rate at gate</span>
                <span className="font-bold text-primary">
                  {rangeData.firstTry.firstTries > 0
                    ? `${Math.round((rangeData.firstTry.passed / rangeData.firstTry.firstTries) * 100)}% first-try`
                    : "no first tries yet"}
                </span>
              </div>
            </section>
          </div>

          {/* ------------------------- Key Heatmap ------------------------- */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  grid_on
                </span>
                Key Heatmap // {range === "all" ? "All-Time" : range === "90d" ? "90-Day" : "30-Day"} Accuracy
              </h3>
              <span className="flex items-center gap-2 font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                <span className="rounded bg-error-container px-1.5 py-0.5 text-error">&lt;85% weak</span>
                <span className="rounded bg-secondary-container/60 px-1.5 py-0.5 text-secondary">85–93%</span>
                <span className="rounded bg-primary-container/30 px-1.5 py-0.5 text-primary">93–97%</span>
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-primary">&ge;97% strong</span>
                <span className="rounded bg-surface-container-high px-1.5 py-0.5">no data</span>
              </span>
            </div>
            <KeyHeatmap data={heatmapData} slowest={slowest} />
            {heatmapData.length === 0 && (
              <p className="mt-2 rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/40 px-space-base py-3 text-center font-code-sm text-code-sm text-outline">
                No key statistics in this window yet — finish a lesson and the
                heatmap fills from your real per-character accuracy.
              </p>
            )}
          </section>

          {/* ------------------- Training Consistency ------------------- */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  calendar_month
                </span>
                Training Consistency // 90-Day
              </h3>
              <span className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                height = minutes trained
              </span>
            </div>
            {consistencyError ? (
              <p className="rounded-lg border border-error/40 bg-error-container/20 px-space-base py-3 text-center font-code-sm text-code-sm text-error">
                Consistency unavailable — the training ledger could not be read.
              </p>
            ) : (
              <ConsistencyStrip
                days={consistency ?? []}
                variant="wide"
                loading={consistency === null}
              />
            )}
          </section>

          {/* ------------------- Raw log + sidebar grid ------------------- */}
          <div className="grid grid-cols-1 gap-space-md xl:grid-cols-3">
            {/* Attempt history // raw log */}
            <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl xl:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary-container">
                    table_chart
                  </span>
                  Attempt History // Raw Log
                </h3>
                <button
                  type="button"
                  onClick={() => void exportCsv()}
                  disabled={exporting}
                  className="font-code-sm text-code-sm font-bold tracking-wider text-primary hover:text-primary-fixed disabled:opacity-50"
                >
                  {exporting ? "EXPORTING…" : "EXPORT CSV ↓"}
                </button>
              </div>
              {!history || history.rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-base py-space-lg text-center font-code-sm text-code-sm text-outline">
                  No attempts logged in this range — the raw ledger stays empty
                  until a lesson is finished.
                </p>
              ) : (
                <>
                  <table className="w-full text-left font-code-md text-code-md">
                    <thead>
                      <tr className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                        <th className="pb-2 pr-2 font-semibold">#</th>
                        <th className="pb-2 pr-2 font-semibold">Module</th>
                        <th className="pb-2 pr-2 text-right font-semibold">WPM</th>
                        <th className="pb-2 pr-2 text-right font-semibold">ACC</th>
                        <th className="pb-2 pr-2 text-right font-semibold">ERR</th>
                        <th className="pb-2 pr-2 text-right font-semibold">BKSP</th>
                        <th className="pb-2 pr-2 text-right font-semibold">Duration</th>
                        <th className="pb-2 text-center font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.rows.map((row) => {
                        const lesson = getLesson(row.lessonId);
                        return (
                          <tr
                            key={row.id}
                            className="border-t border-surface-container-highest/30"
                          >
                            <td className="py-2 pr-2 text-outline">{row.id}</td>
                            <td className="py-2 pr-2 text-on-surface">
                              {lesson
                                ? `${moduleNumber(lesson.level, lesson.orderIndex)} ${lesson.title}`
                                : row.lessonId}
                            </td>
                            <td className="py-2 pr-2 text-right font-bold text-primary">
                              {Math.round(row.wpm)}
                            </td>
                            <td className="py-2 pr-2 text-right text-on-surface">
                              {fmt1(row.accuracy)}%
                            </td>
                            <td className="py-2 pr-2 text-right text-error">{row.errorCount}</td>
                            <td className="py-2 pr-2 text-right text-on-surface-variant">
                              {row.backspaceCount}
                            </td>
                            <td className="py-2 pr-2 text-right text-on-surface-variant">
                              {fmtDuration(row.durationMs)}
                            </td>
                            <td className="py-2 text-center">
                              {resultChip(row.completed, row.wpm, row.accuracy)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
                    <span>
                      {fmtInt(history.total)} attempts • page {history.page + 1} of{" "}
                      {totalPages} • nothing reduced to a best score
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={history.page === 0}
                        onClick={() => void loadHistoryPage(history.page - 1)}
                        className="rounded border border-surface-container-highest/60 bg-surface-container-lowest px-2 py-0.5 tracking-wider text-on-surface disabled:opacity-40 hover:bg-surface-container"
                      >
                        ‹ PREV
                      </button>
                      <button
                        type="button"
                        disabled={history.page >= totalPages - 1}
                        onClick={() => void loadHistoryPage(history.page + 1)}
                        className="rounded border border-surface-container-highest/60 bg-surface-container-lowest px-2 py-0.5 tracking-wider text-on-surface disabled:opacity-40 hover:bg-surface-container"
                      >
                        NEXT ›
                      </button>
                    </span>
                  </div>
                </>
              )}
            </section>

            {/* Sidebar: per-level mastery + improvement */}
            <div className="flex flex-col gap-space-md">
              <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
                <h3 className="mb-3 flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary-container">
                    stacked_bar_chart
                  </span>
                  Per-Level Mastery
                </h3>
                <div className="flex flex-col gap-2">
                  {perLevelMastery.map((level) => (
                    <div key={level.level}>
                      <div className="flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                        <span>
                          L{level.level} {level.tagline}
                        </span>
                        <span className={cn(level.completed === level.total ? "text-primary" : "text-on-surface")}>
                          {level.completed}/{level.total}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-container-lowest">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-secondary-container via-primary-container to-primary"
                          style={{
                            width: `${Math.min(100, Math.max(0, level.pct))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
                <h3 className="mb-1 font-code-sm text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Improvement Across Attempts
                </h3>
                <ImprovementChart buckets={improvement} />
                <div className="mt-1 flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-outline">
                  <span>att 1</span>
                  <span>att 5+</span>
                </div>
                <p className="mt-2 font-code-sm text-[11px] leading-relaxed text-on-surface-variant">
                  Mean attempt-5+ WPM is{" "}
                  <strong className={cn("font-bold", improvementDelta >= 0 ? "text-primary" : "text-error")}>
                    {improvementDelta >= 0 ? "+" : ""}
                    {fmt1(improvementDelta)}
                  </strong>{" "}
                  over attempt-1. Raw per-attempt rows remain available above —
                  history is never reduced to a single best score.
                </p>
              </section>
            </div>
          </div>

          <p className="px-1 pb-1 font-code-sm text-[10px] uppercase tracking-wider text-outline-variant">
            Raw log page size {HISTORY_PAGE_SIZE} • CSV export contains every
            filtered row, not a summary
          </p>
        </>
      )}
    </main>
  );
}
