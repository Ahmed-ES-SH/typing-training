import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getPosition } from "../lib/stats/progressService";
import { attemptsRepo, keyStatsRepo } from "../lib/db/repositories";
import { cn } from "../lib/cn";
import { CHAR_NAMES } from "../lib/intelligence/adaptiveGenerator";
import {
  analyzeWeaknesses,
  dayKeyBefore,
  focusKeysOf,
  projectRecovery,
  type WeaknessAnalysis,
  type WeaknessTarget,
} from "../lib/intelligence/analyzer";
import {
  buildDrillPlan,
  getDrillConfig,
  newDrillSeed,
  type DrillPlan,
} from "../lib/intelligence/drillService";
import type { DrillConfig } from "../lib/schemas";
import { liveMetrics } from "../lib/engine/metrics";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Weakness Training screen (PRD §15; Phase 6 plan §3.6) — implemented from
 * `screens/weakness_training_typekernel/code.html`:
 *
 * - Queue sidebar: Target Elimination Queue with per-key cards, evolution
 *   chain and the read-only Drill Configuration block (defaults per design;
 *   editing UI arrives in Phase 7).
 * - Main drill area: generated sets typed through the Phase 3 engine
 *   (via useSessionStore drill mode), focus-key accounting, set summaries.
 * - Target Recovery Curves: 30-day accuracy per queued key (Recharts) with
 *   display-only linear-regression projections.
 *
 * The screen (and recharts) is lazy-loaded from App; ESC returns to the
 * dashboard and abandons the running drill.
 */

const GRID = "#31353f";
const TOOLTIP_STYLE = {
  background: "#0a0e17",
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 11,
} as const;

const CURVE_COLORS = ["#ffb4ab", "#ff6d2c", "#d97722", "#ffb783", "#f97316", "#9d4300"];

const fmtClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/* ---------------------------------------------------------------------------
 * Queue sidebar
 * ------------------------------------------------------------------------- */

function QueueCard({ target }: { target: WeaknessTarget }) {
  const isTargeted = target.state === "targeted";
  const isMaintenance = target.state === "maintenance";
  const acc = Math.round(target.accuracy);
  const tone = isTargeted
    ? { border: "border-error/40", badge: "bg-error-container/40 text-error", bar: "bg-error", icon: "error", iconColor: "text-error" }
    : isMaintenance
      ? { border: "border-secondary/40", badge: "bg-secondary-container/30 text-secondary", bar: "bg-secondary", icon: "adjust", iconColor: "text-secondary" }
      : { border: "", badge: "bg-primary-container/20 text-primary", bar: "", icon: "check_circle", iconColor: "text-primary" };

  return (
    <div
      className={cn(
        "p-space-sm rounded-lg bg-surface-container-lowest/70",
        isTargeted || isMaintenance ? `border ${tone.border}` : "opacity-75 bg-surface-container-lowest/40",
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span
            className={cn("material-symbols-outlined text-[16px]", tone.iconColor)}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {tone.icon}
          </span>
          <span className="font-code-lg text-code-lg font-bold text-on-surface">{target.key}</span>
          <span className="font-code-sm text-code-sm text-on-surface-variant">
            {CHAR_NAMES[target.key] ?? "symbol"}
          </span>
        </div>
        <span className={cn("font-code-sm text-code-sm px-1.5 py-0.5 rounded font-bold", tone.badge)}>
          {acc}% ACC
        </span>
      </div>
      {(isTargeted || isMaintenance) && (
        <>
          <div className="mb-1 h-1 w-full overflow-hidden rounded-full bg-surface-container-lowest">
            <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, acc)}%` }} />
          </div>
          <div className="flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
            <span>
              {target.presses.toLocaleString()} exposures • {target.misses.toLocaleString()} misses
            </span>
            {target.priority !== null && <span className="text-error">PRIORITY {target.priority}</span>}
            {target.priority === null && (
              <span className="text-secondary">{isMaintenance ? "MAINTENANCE" : "IN POOL"}</span>
            )}
          </div>
        </>
      )}
      {!isTargeted && !isMaintenance && (
        <div className="font-code-sm text-code-sm text-on-surface-variant">
          Graduated {target.stateSince} • {target.state === "eliminated" ? "eliminated" : "maintenance pool"}
        </div>
      )}
    </div>
  );
}

/** §20 adaptive-lessons gate: disabled start button + note when the
 * generator injection is switched off in Settings. */
function AdaptiveGate({ children }: { children: React.ReactNode }) {
  const adaptive = useSettingsStore((s) => s.settings.adaptiveLessons);
  if (adaptive) return <>{children}</>;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        disabled
        title="Enable adaptive lessons in Settings"
        className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-surface-container-high py-2 font-label-md text-sm font-semibold text-on-surface-variant opacity-60"
      >
        <span className="material-symbols-outlined text-[16px]">lock</span>
        <span>ADAPTIVE LESSONS OFF</span>
      </button>
      <p className="text-center font-code-sm text-[10px] uppercase tracking-wider text-outline">
        enable in settings // training
      </p>
    </div>
  );
}

function QueueSidebar({
  analysis,
  config,
  drillNumber,
  onStart,
  busy,
  running,
}: {
  analysis: WeaknessAnalysis | null;
  config: DrillConfig | null;
  drillNumber: number;
  onStart: () => void;
  busy: boolean;
  running: boolean;
}) {
  const targets = analysis?.targets ?? [];
  const active = targets.filter((t) => t.state === "targeted" || t.state === "maintenance");
  const graduated = targets.filter((t) => t.state === "eliminated");

  // Evolution chain (display-only): the current active set shrinking as the
  // strongest keys graduate — "{ : ] _ → : ] _ → ]".
  const chainNow = active.slice(0, 4).map((t) => t.key).join(" ");
  const chainNext = active.filter((t) => t.accuracy < 90).map((t) => t.key).join(" ") || chainNow;
  const chainLast = active.length > 0 ? focusKeysOf(analysis!, 1).map((t) => t.key).join(" ") : "";

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-surface-container-highest/30 bg-surface-container-low shadow-2xl lg:w-88 xl:w-96">
      <div className="relative overflow-hidden border-b border-surface-container-highest/40 bg-gradient-to-b from-error-container/10 to-transparent p-space-base">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-error/15 blur-2xl" />
        <div className="mb-1.5 flex items-center justify-between font-code-sm text-code-sm text-on-surface-variant">
          <span className="font-bold tracking-wider text-error">WEAKNESS QUEUE // AUTO-GEN</span>
          <span className="rounded bg-surface-container px-space-xs py-0.5 font-bold font-code-sm text-error">
            {active.length} KEYS
          </span>
        </div>
        <h2 className="mb-2 font-headline-md text-headline-md leading-snug tracking-tight text-on-surface">
          Target Elimination Queue
        </h2>
        <p className="mb-space-sm font-body-sm text-body-sm text-on-surface-variant">
          Ranked by rolling 30-day error density. Sessions re-weight
          automatically as keys improve.
        </p>
        {active.length > 0 && (
          <div className="flex items-center gap-1 font-code-sm text-code-sm text-on-surface-variant">
            <span className="text-on-surface">EVOLUTION:</span>
            <span className="rounded bg-error-container/40 px-1 py-0.5 font-bold text-error">{chainNow}</span>
            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
            <span className="rounded bg-secondary-container/30 px-1 py-0.5 font-bold text-secondary">{chainNext}</span>
            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
            <span className="rounded bg-surface-container px-1 py-0.5 text-on-surface-variant">{chainLast}</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-space-xs overflow-y-auto p-space-sm">
        {analysis === null ? (
          <p className="animate-pulse py-6 text-center font-code-sm text-code-sm text-outline">
            Analyzing key statistics…
          </p>
        ) : targets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 p-space-base text-center">
            <p className="font-code-sm text-code-sm font-bold uppercase tracking-wider text-outline">
              {analysis.empty ? "No weaknesses detected yet" : "Queue empty"}
            </p>
            <p className="mt-1 font-code-sm text-code-sm text-on-surface-variant">
              {analysis.empty
                ? "Complete a few lessons to detect weaknesses — per-key statistics build as you type."
                : "Every tracked key is above the 90% accuracy line. Keep it up."}
            </p>
          </div>
        ) : (
          <>
            {active.map((target) => (
              <QueueCard key={`${target.key}-${target.shiftRequired}`} target={target} />
            ))}
            {graduated.map((target) => (
              <QueueCard key={`${target.key}-${target.shiftRequired}`} target={target} />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-surface-container-highest/40 bg-surface-container-lowest/40 p-space-sm">
        <div className="mb-1.5 font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
          Drill Configuration
        </div>
        <div className="flex flex-col gap-1.5 font-code-sm text-code-sm">
          {[
            ["Session length", `${config?.setLength ?? 120} keys`],
            [
              "Symbol weight",
              config ? `AGGRESSIVE ×${config.symbolWeight}` : "—",
              "text-primary",
            ],
            [
              "Word context",
              config?.wordContext === "code_identifiers" ? "Code identifiers" : "Plain words",
            ],
            [
              "Backspace policy",
              config?.backspacePolicy === "counted" ? "Counted" : "Ignored",
            ],
          ].map(([label, value, tone]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded bg-surface-container-low px-2 py-1.5"
              title="Read-only until Phase 7 (Settings)"
            >
              <span className="text-on-surface-variant">{label}</span>
              <span className={cn("font-bold text-on-surface", tone)}>{value}</span>
            </div>
          ))}
        </div>
        <AdaptiveGate>
          <button
            type="button"
            onClick={onStart}
            disabled={busy || analysis === null}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/25 transition-all hover:bg-tertiary-container disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">bolt</span>
            <span>
              {busy ? "GENERATING…" : running ? "RESTART DRILL" : `START DRILL ${drillNumber}`}
            </span>
          </button>
        </AdaptiveGate>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * Drill area
 * ------------------------------------------------------------------------- */

/** Code buffer with weak targets pre-tinted before they are typed. */
function DrillBuffer({
  content,
  engineState,
  focusKeys,
  running,
}: {
  content: string;
  engineState: import("../lib/engine/types").SessionState;
  focusKeys: string[];
  running: boolean;
}) {
  const focus = useMemo(() => new Set(focusKeys), [focusKeys]);
  const lines = useMemo(() => {
    const result: { text: string; offset: number }[] = [];
    let offset = 0;
    for (const text of content.split("\n")) {
      result.push({ text, offset });
      offset += text.length + 1;
    }
    return result;
  }, [content]);
  const activeLine = lines.findIndex(
    (line) => engineState.position >= line.offset && engineState.position <= line.offset + line.text.length,
  );

  return (
    <div className="rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest/90 p-space-base font-code-lg text-code-lg leading-loose select-none">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex}>
          <span className="select-none text-on-surface-variant">
            {String(lineIndex + 1).padStart(2, "0")}│{" "}
          </span>
          {Array.from(line.text).map((expected, i) => {
            const globalIndex = line.offset + i;
            const entry = engineState.entries[globalIndex];
            if (entry === undefined) return null;
            const isCurrent = running && globalIndex === engineState.position;
            // §15: focus targets are error-tinted BEFORE they are typed so
            // the operator sees what the drill is training.
            const isFocus = focus.has(expected) && expected !== " ";
            const cls =
              entry.status === "correct"
                ? "text-on-surface"
                : entry.status === "incorrect"
                  ? "rounded bg-error-container/30 px-0.5 text-error"
                  : isFocus
                    ? "rounded bg-error-container/30 px-0.5 font-bold text-error"
                    : expected === ":" || expected === "{" || expected === "}" || expected === "[" || expected === "]"
                      ? "font-bold text-primary"
                      : "text-on-surface-variant";
            return (
              <span
                key={globalIndex}
                className={cn(
                  cls,
                  isCurrent && "rounded border border-primary-container/50 bg-primary-container/25 px-0.5 text-primary",
                )}
              >
                {expected === " " ? "\u00A0" : expected}
              </span>
            );
          })}
        </div>
      ))}
      {activeLine === -1 && running && (
        <span className="inline-block h-5 w-2.5 animate-pulse bg-primary-container" />
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  suffix,
  note,
  tone = "text-on-surface",
}: {
  label: string;
  value: string;
  suffix?: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-container p-space-sm text-center">
      <div className="font-code-sm text-code-sm uppercase text-on-surface-variant">{label}</div>
      <div className={cn("font-headline-lg text-headline-lg", tone)}>
        {value}
        {suffix && <span className="font-headline-md text-on-surface-variant">{suffix}</span>}
      </div>
      {note && <div className="font-code-sm text-code-sm text-on-surface-variant">{note}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Recovery curves
 * ------------------------------------------------------------------------- */

function RecoveryCurves({ analysis }: { analysis: WeaknessAnalysis | null }) {
  const [series, setSeries] = useState<{
    keys: string[];
    rows: Record<string, number | string>[];
    projections: Record<string, { slopePerDay: number; current: number; projected: number; etaDays: number | null }>;
  }>({ keys: [], rows: [], projections: {} });

  useEffect(() => {
    if (analysis === null) return;
    let cancelled = false;
    const keys = analysis.targets
      .filter((t) => t.state !== "eliminated")
      .slice(0, 6)
      .map((t) => t.key);
    if (keys.length === 0) {
      setSeries({ keys: [], rows: [], projections: {} });
      return;
    }
    void (async () => {
      try {
        const daily = await keyStatsRepo.dailySince(dayKeyBefore(Date.now(), 30));
        const byDay = new Map<string, Record<string, number | string>>();
        const perKey = new Map<string, { presses: number; correct: number }[]>();
        for (const row of daily) {
          if (!keys.includes(row.key) || row.presses === 0) continue;
          const bucket = byDay.get(row.date) ?? { day: row.date.slice(5) };
          bucket[row.key] = Math.round((row.correct / row.presses) * 1000) / 10;
          byDay.set(row.date, bucket);
          const list = perKey.get(row.key) ?? [];
          list.push({ presses: row.presses, correct: row.correct });
          perKey.set(row.key, list);
        }
        const projections: typeof series.projections = {};
        for (const key of keys) {
          const rows = (perKey.get(key) ?? []).map((r) => ({
            day: "",
            presses: r.presses,
            correct: r.correct,
          }));
          // Anchor at the SAME rolling-30d accuracy the queue card shows —
          // not the last single day (which contradicted the queue card).
          const override = analysis.targets.find((t) => t.key === key)?.accuracy;
          projections[key] = projectRecovery(rows, override);
        }
        if (!cancelled) setSeries({ keys, rows: [...byDay.values()], projections });
      } catch {
        if (!cancelled) setSeries({ keys: [], rows: [], projections: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysis]);

  return (
    <div className="rounded-xl bg-surface-container-low p-space-base shadow-md">
      <div className="mb-space-sm flex items-center justify-between">
        <h3 className="flex items-center gap-space-xs font-headline-md text-headline-md text-on-surface">
          <span className="material-symbols-outlined text-[20px] text-primary">timeline</span>
          Target Recovery Curves
        </h3>
        <span className="font-code-sm text-code-sm text-on-surface-variant">
          30-day accuracy per queued key
        </span>
      </div>
      {series.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/40 px-space-base py-6 text-center font-code-sm text-code-sm text-outline">
          No daily history yet — curves appear after a few training days.
          Single-day histories fall back to lifetime values in the queue cards.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={series.rows} margin={{ top: 6, right: 24, bottom: 0, left: -22 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#a78b7d", fontFamily: "JetBrains Mono" }} tickLine={false} stroke={GRID} />
              <YAxis domain={[55, 100]} tick={{ fontSize: 9, fill: "#a78b7d", fontFamily: "JetBrains Mono" }} tickLine={false} stroke={GRID} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <ReferenceLine y={90} stroke="#d97722" strokeDasharray="5 4" strokeOpacity={0.7} />
              <ReferenceLine y={95} stroke="#f97316" strokeDasharray="5 4" strokeOpacity={0.7} />
              {series.keys.map((key, i) => (
                <Line
                  key={key}
                  dataKey={key}
                  stroke={CURVE_COLORS[i % CURVE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-space-sm flex flex-col gap-1.5">
            {analysis?.targets
              .filter((t) => t.state !== "eliminated")
              .map((target) => {
                const color =
                  CURVE_COLORS[
                    series.keys.indexOf(target.key) % CURVE_COLORS.length
                  ];
                const projection = series.projections[target.key];
                return (
                  <div
                    key={`${target.key}-${target.shiftRequired}`}
                    className="flex items-center justify-between rounded bg-surface-container-lowest px-2 py-1.5 font-code-sm text-code-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-on-surface">{target.key}</span>
                      <span className="text-on-surface-variant">
                        {projection && projection.slopePerDay > 0
                          ? `improving +${projection.slopePerDay.toFixed(1)}%/day${
                              projection.etaDays !== null
                                ? ` — elimination ETA ${projection.etaDays} days`
                                : ""
                            }`
                          : projection && projection.slopePerDay < 0
                            ? `declining ${projection.slopePerDay.toFixed(1)}%/day`
                            : `${Math.round(target.accuracy)}% · ${target.state}`}
                      </span>
                    </span>
                    <span className={target.accuracy >= 90 ? "text-secondary" : "text-primary"}>
                      {projection
                        ? `${Math.round(projection.current)}% → ${Math.round(projection.projected)}% projected`
                        : target.state === "targeted"
                          ? "needs ≥90% ×7 days"
                          : "graduated — hold 95% ×7 days"}
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Screen
 * ------------------------------------------------------------------------- */

export default function WeaknessTrainingScreen() {
  const [analysis, setAnalysis] = useState<WeaknessAnalysis | null>(null);
  const [config, setConfig] = useState<DrillConfig | null>(null);
  const [drillNumber, setDrillNumber] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planRef = useRef<DrillPlan | null>(null);

  const drill = useSessionStore((s) => s.drill);
  const phase = useSessionStore((s) => s.phase);
  const engineState = useSessionStore((s) => s.engineState);
  const lesson = useSessionStore((s) => s.lesson);
  const now = useSessionStore((s) => s.now);

  const running = phase === "running" || phase === "set-summary";

  const reloadAnalysis = useCallback(async () => {
    try {
      const [a, cfg] = await Promise.all([analyzeWeaknesses(), getDrillConfig()]);
      setAnalysis(a);
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await reloadAnalysis();
      try {
        setDrillNumber((await attemptsRepo.countByKind("weakness")) + 1);
      } catch {
        // Header number stays 1 — cosmetic only.
      }
    })();
  }, [reloadAnalysis]);

  // ESC returns to the dashboard; refresh the drill counter when a drill
  // completes (its sets are persisted as weakness attempts).
  useEffect(() => {
    if (phase !== "finished") return;
    void attemptsRepo
      .countByKind("weakness")
      .then((count) => setDrillNumber(count + 1))
      .catch(() => undefined);
    void reloadAnalysis();
  }, [phase, reloadAnalysis]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      void useSessionStore.getState().abandon();
      useUiStore.getState().navigate("dashboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Typing input — only while a drill set is actively running.
  useEffect(() => {
    if (phase !== "running") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        useSessionStore.getState().backspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        useSessionStore.getState().typeChar("\n");
      } else if (event.key === "Tab") {
        event.preventDefault();
        useSessionStore.getState().typeChar(" ");
      } else if (event.key.length === 1) {
        event.preventDefault();
        useSessionStore.getState().typeChar(event.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]);

  const startDrill = async () => {
    if (analysis === null || config === null) return;
    // §20 adaptive-lessons toggle gates the Phase 6 generator injection.
    if (!useSettingsStore.getState().settings.adaptiveLessons) return;
    setBusy(true);
    try {
      const position = await getPosition().catch(() => null);
      const userLevel = position?.currentLesson?.level ?? 1;
      const plan = buildDrillPlan(analysis, config, newDrillSeed(), userLevel);
      planRef.current = plan;
      await useSessionStore.getState().startDrill(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start drill");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (analysis === null || config === null) return;
    if (!useSettingsStore.getState().settings.adaptiveLessons) return;
    setBusy(true);
    try {
      const position = await getPosition().catch(() => null);
      const userLevel = position?.currentLesson?.level ?? 1;
      const plan = buildDrillPlan(analysis, config, newDrillSeed(), userLevel);
      planRef.current = plan;
      await useSessionStore.getState().startDrill(plan); // new seed, set 0
    } finally {
      setBusy(false);
    }
  };

  const metrics =
    engineState !== null && running
      ? liveMetrics(engineState, phase === "running" ? now : engineState.finishedAt ?? now)
      : null;
  const focusKeys = drill?.plan.focusKeys ?? [];
  const lastResult = drill?.setResults.length
    ? drill.setResults[drill.setResults.length - 1]
    : null;
  const prevResult = drill && drill.setResults.length > 1 ? drill.setResults[drill.setResults.length - 2] : null;

  return (
    <main className="flex w-full flex-1 gap-space-sm overflow-hidden bg-surface p-space-sm sm:p-space-base">
      <QueueSidebar
        analysis={analysis}
        config={config}
        drillNumber={drillNumber}
        onStart={() => void startDrill()}
        busy={busy}
        running={running}
      />

      <section className="flex min-w-0 flex-1 flex-col gap-space-sm overflow-y-auto">
        {error !== null && (
          <div className="rounded-lg border border-error/40 bg-error-container/40 px-space-base py-2 font-code-sm text-code-sm text-error">
            {error}
          </div>
        )}

        {/* ------------------------- Drill area ------------------------- */}
        <div className="relative overflow-hidden rounded-xl border border-error/30 bg-surface-container-low p-space-lg shadow-xl">
          <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-error/10 blur-3xl" />
          <div className="relative z-10">
            <div className="mb-space-base flex flex-wrap items-center justify-between gap-space-sm">
              <div className="flex items-center gap-space-xs">
                <span className="inline-flex items-center gap-1.5 rounded bg-error-container/40 px-space-xs py-space-2xs font-code-sm uppercase tracking-wider text-error">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-error" />
                  {drill !== null ? `DRILL ${drillNumber} // GENERATED FROM YOUR DATA` : "NO DRILL RUNNING"}
                </span>
                <span className="font-code-sm text-code-sm text-on-surface-variant">
                  FOCUS: {focusKeys.length > 0 ? focusKeys.join(" ") : "—"}
                </span>
              </div>
              {drill !== null && (
                <div className="flex items-center gap-space-xs font-code-sm text-code-sm">
                  <span className="rounded bg-surface-container px-space-xs py-0.5 text-on-surface-variant">
                    SET {drill.setIndex + 1} OF {drill.plan.sets.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    className="flex items-center gap-1 rounded bg-surface-container px-space-xs py-0.5 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[14px]">refresh</span>
                    REGENERATE
                  </button>
                </div>
              )}
            </div>

            {drill === null || lesson === null || engineState === null ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-surface-container-highest/50 bg-surface-container-lowest/40 p-space-lg text-center">
                <span className="material-symbols-outlined text-[36px] text-outline">monitor_heart</span>
                <p className="mt-2 font-headline-md text-headline-md text-on-surface">
                  {analysis !== null && analysis.targets.length === 0
                    ? "No weaknesses queued"
                    : "Start a drill from the queue"}
                </p>
                <p className="mt-1 max-w-md font-body-sm text-body-sm text-on-surface-variant">
                  {analysis !== null && analysis.targets.length === 0
                    ? "The analyzer could not find enough weak keys to build a drill. Complete lessons to accumulate key statistics, then come back."
                    : "Drills are generated from your rolling 30-day key statistics: weak symbols injected at ×3 frequency inside real identifier contexts, 5 sets of 120 keystrokes."}
                </p>
              </div>
            ) : (
              <>
                <h1 className="mb-1 font-headline-xl text-headline-xl tracking-tight text-on-surface">
                  {lesson.title}
                </h1>
                <p className="mb-space-base font-body-sm text-body-sm text-on-surface-variant">
                  Adaptive drill: weak symbols injected at{" "}
                  <span className="font-bold text-error">×{drill.plan.config.symbolWeight} frequency</span>{" "}
                  inside real identifier contexts. Content reshapes after every set.
                </p>

                <DrillBuffer
                  content={lesson.content}
                  engineState={engineState}
                  focusKeys={focusKeys}
                  running={phase === "running"}
                />

                <div className="mt-space-base grid grid-cols-2 gap-space-sm md:grid-cols-4">
                  <StatCell
                    label="Drill WPM"
                    value={metrics ? Math.round(metrics.wpm).toString() : "0"}
                    note="target ≥ 30"
                    tone={metrics && metrics.wpm >= 30 ? "text-primary" : "text-on-surface"}
                  />
                  <StatCell
                    label="Accuracy"
                    value={metrics ? `${metrics.accuracy.toFixed(1)}` : "100.0"}
                    suffix="%"
                    note={prevResult ? `last set ${Math.round(prevResult.accuracy)}%` : "first set"}
                    tone={metrics && metrics.accuracy < 90 ? "text-error" : "text-on-surface"}
                  />
                  {(() => {
                    const focusEvents = engineState.keyEvents.filter((e) => focusKeys.includes(e.expected));
                    const hits = focusEvents.filter((e) => e.correct).length;
                    const misses = focusEvents.length - hits;
                    return (
                      <StatCell
                        label="Focus Key Hits"
                        value={hits.toString()}
                        suffix={`/${focusEvents.length}`}
                        note={misses > 0 ? `${misses} misses on ${focusKeys[0] ?? "—"}` : "no focus misses"}
                      />
                    );
                  })()}
                  <StatCell
                    label="Elapsed"
                    value={metrics ? fmtClock(metrics.elapsedMs) : "00:00"}
                    note={`set ${drill.setIndex + 1} of ${drill.plan.sets.length}`}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Set summary overlay between sets / final summary */}
        {phase === "set-summary" && drill !== null && lastResult !== null && (
          <div className="rounded-xl border border-primary-container/40 bg-surface-container-low p-space-lg shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-headline-md text-headline-md text-on-surface">
                SET {drill.setIndex} OF {drill.plan.sets.length} COMPLETE
              </h3>
              <button
                type="button"
                onClick={() => useSessionStore.getState().resumeDrill()}
                className="flex items-center gap-2 rounded-lg bg-primary-container px-space-lg py-2 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/30 hover:bg-tertiary-container"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                NEXT SET ({drill.setIndex + 1} of {drill.plan.sets.length})
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-space-sm md:grid-cols-4">
              <StatCell label="WPM" value={Math.round(lastResult.wpm).toString()} tone="text-primary" />
              <StatCell label="Accuracy" value={lastResult.accuracy.toFixed(1)} suffix="%" />
              <StatCell
                label="Focus Hits"
                value={lastResult.focus.hits.toString()}
                suffix={`/${lastResult.focus.total}`}
                note={`${lastResult.focus.leadMisses} misses on ${focusKeys[0] ?? "—"}`}
              />
              <StatCell label="Duration" value={fmtClock(lastResult.durationMs)} />
            </div>
          </div>
        )}

        {phase === "finished" && drill !== null && drill.setResults.length > 0 && (
          <div className="rounded-xl border border-secondary/40 bg-surface-container-low p-space-lg shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-headline-md text-headline-md text-on-surface">DRILL COMPLETE</h3>
              <button
                type="button"
                onClick={() => void regenerate()}
                className="flex items-center gap-2 rounded-lg bg-primary-container px-space-lg py-2 font-label-md text-sm font-semibold text-on-primary-container hover:bg-tertiary-container"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                NEW DRILL
              </button>
            </div>
            <p className="font-code-sm text-code-sm text-on-surface-variant">
              {drill.setResults.length} sets saved as weakness attempts • queue
              updates on your next visit.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-space-sm md:grid-cols-4">
              {(() => {
                const totalFocus = drill.setResults.reduce((s, r) => s + r.focus.total, 0);
                const totalHits = drill.setResults.reduce((s, r) => s + r.focus.hits, 0);
                const avgWpm = drill.setResults.reduce((s, r) => s + r.wpm, 0) / drill.setResults.length;
                const avgAcc = drill.setResults.reduce((s, r) => s + r.accuracy, 0) / drill.setResults.length;
                return (
                  <>
                    <StatCell label="Avg WPM" value={Math.round(avgWpm).toString()} tone="text-primary" note="target ≥ 30" />
                    <StatCell label="Avg Accuracy" value={avgAcc.toFixed(1)} suffix="%" />
                    <StatCell label="Focus Hits" value={totalHits.toString()} suffix={`/${totalFocus}`} />
                    <StatCell
                      label="Total Time"
                      value={fmtClock(drill.setResults.reduce((s, r) => s + r.durationMs, 0))}
                    />
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ---------------------- Recovery curves ---------------------- */}
        <RecoveryCurves analysis={analysis} />

        <p className="px-1 pb-1 font-code-sm text-[10px] uppercase tracking-wider text-outline-variant">
          ESC returns to the dashboard • analyzer runs on navigation, never per
          keystroke • all intelligence is local
        </p>
      </section>
    </main>
  );
}
