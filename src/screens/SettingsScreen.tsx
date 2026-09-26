import { useEffect, useMemo, useState } from "react";

import {
  KernelButton,
  PillGroup,
  RadioCard,
  SectionCard,
  Select,
  SettingRow,
  ToggleRow,
} from "../components/FormPrimitives";
import { Modal, TypedConfirmModal } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";
import { ACCURACY_GATE, WPM_GATE } from "../lib/curriculum/rules";
import { seedCurriculum } from "../lib/curriculum/seed";
import { statsRepo } from "../lib/db/repositories";
import { exportBackupJson, EXPORT_UNSUPPORTED_MESSAGE } from "../lib/io/backupExport";
import type { ExportEnvelope } from "../lib/io/exportSchema";
import {
  applyEnvelope,
  crossRowIssues,
  importReport,
  parseEnvelope,
  planMerge,
} from "../lib/io/importer";
import {
  checkForUpdates,
  inTauri,
  readTextFileViaDialog,
  resetDatabase,
} from "../lib/io/fileIo";
import { THEMES } from "../lib/themeCatalog";
import { useSettingsStore, type ThemeId } from "../stores/useSettingsStore";
import { useDailyGoalsStore } from "../stores/useDailyGoalsStore";
import { cn } from "../lib/cn";

/**
 * Settings — "System Configuration" (§20), implemented from
 * `screens/settings_typekernel/code.html`. Every control persists instantly
 * (debounced) to the `settings` table; strict mode is §8 product law and
 * renders LOCKED; the danger zone wipes the DB behind a typed RESET.
 */

type SectionId =
  | "keyboard"
  | "appearance"
  | "training"
  | "statistics"
  | "data"
  | "application";

const NAV: { id: SectionId; label: string; icon: string }[] = [
  { id: "keyboard", label: "Keyboard Layout", icon: "keyboard" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "training", label: "Training Preferences", icon: "tune" },
  { id: "statistics", label: "Statistics", icon: "monitoring" },
  { id: "data", label: "Data Management", icon: "database" },
  { id: "application", label: "Application", icon: "app_settings_alt" },
];

export default function SettingsScreen() {
  const { settings, update, hydrated } = useSettingsStore();
  const [activeSection, setActiveSection] = useState<SectionId>("keyboard");
  const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [importState, setImportState] = useState<
    | { phase: "idle" }
    | { phase: "confirm"; envelope: ExportEnvelope; report: string[] }
    | { phase: "report"; envelope: ExportEnvelope; report: string[] }
    | { phase: "error"; title: string; issues: string[] }
    | { phase: "success"; message: string }
    | { phase: "busy" }
  >({ phase: "idle" });
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  useEffect(() => {
    void statsRepo
      .dbSizeBytes()
      .then(setDbSizeBytes)
      .catch(() => setDbSizeBytes(null));
  }, [hydrated, importState, resetError]);

  const updateVersion = useMemo(() => {
    return `TypeKernel v${__APP_VERSION__} • Tauri 2 • SQLite schema v4`;
  }, []);

  /* ------------------------------- data actions --------------------------- */

  const exportBackup = async () => {
    // §5.2.4 — the flow itself lives in `lib/io/backupExport` so the command
    // palette runs the identical one; messaging stays here (observable
    // behavior unchanged: cancel is silent, failures land in the report).
    if (!inTauri()) {
      // Browser dev: no native save dialog, so `saveTextFile` would degrade
      // to the same null as a cancel — report it instead of no-opping.
      setImportState({
        phase: "error",
        title: "Export unavailable",
        issues: [EXPORT_UNSUPPORTED_MESSAGE],
      });
      return;
    }
    try {
      const path = await exportBackupJson();
      if (path !== null) {
        setImportState({
          phase: "success",
          message: `Backup written to ${path}`,
        });
      }
    } catch (error) {
      setImportState({
        phase: "error",
        title: "Backup failed",
        issues: [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const startBackupImport = async () => {
    let picked;
    try {
      picked = await readTextFileViaDialog();
    } catch (error) {
      setImportState({
        phase: "error",
        title: "Could not read file",
        issues: [error instanceof Error ? error.message : String(error)],
      });
      return;
    }
    if (picked === null) return;
    const parsed = parseEnvelope(picked.contents);
    if (!parsed.ok) {
      setImportState({ phase: "error", title: "Invalid file", issues: parsed.issues });
      return;
    }
    const envelope = parsed.envelope;
    if (envelope.kind === "progress-backup") {
      setImportState({
        phase: "confirm",
        envelope,
        report: importReport(envelope, null),
      });
      return;
    }
    // Lessons/collection files merge (same flow as the Module Forge import).
    const rowIssues = crossRowIssues(envelope);
    if (rowIssues.length > 0) {
      setImportState({ phase: "error", title: "Invalid file", issues: rowIssues });
      return;
    }
    setImportState({
      phase: "report",
      envelope,
      report: importReport(envelope, planMerge([], envelope.payload.lessons)),
    });
  };

  const confirmImport = async () => {
    if (importState.phase !== "confirm" && importState.phase !== "report") return;
    setImportState({ phase: "busy" });
    try {
      const result = await applyEnvelope(importState.envelope, {
        confirmReplace: importState.phase === "confirm",
      });
      setImportState({
        phase: "success",
        message:
          "replaced" in result
            ? "Backup restored — all local data replaced."
            : "Lessons merged into your library.",
      });
    } catch (error) {
      setImportState({
        phase: "error",
        title: "Import rejected",
        issues: [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const performReset = async () => {
    setResetBusy(true);
    setResetError(null);
    try {
      await resetDatabase();
      // Re-seed the curriculum on the fresh DB, then reload the app so every
      // store re-hydrates from the pristine state.
      await seedCurriculum().catch(() => undefined);
      window.location.reload();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Reset failed");
      setResetBusy(false);
    }
  };

  const goToSection = (id: SectionId) => {
    setActiveSection(id);
    // Honour `prefers-reduced-motion` (same contract as LessonsScreen's
    // level jump) instead of always animating the scroll.
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior, block: "start" });
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <main className="flex w-full flex-1 flex-col gap-space-base overflow-y-auto bg-surface p-space-sm sm:p-space-base">
      {/* Breadcrumb */}
      <div className="flex items-center gap-space-xs font-code-sm text-code-sm text-on-surface-variant">
        <span className="text-primary">Settings</span>
        <span className="text-outline-variant">/</span>
        <span>Preferences</span>
      </div>

      {/* Hero */}
      <section className="relative w-full overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-primary-container/10 blur-3xl" />
        <div className="relative z-10">
          <span className="mb-space-xs inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-surface-container-high px-2.5 py-0.5 text-xs font-medium text-primary">
            Preferences • Saved locally
          </span>
          <h1 className="font-display-lg text-display-lg tracking-tight text-on-surface">
            Settings
          </h1>
          <p className="mt-space-xs max-w-xl font-body-md text-body-md text-on-surface-variant">
            Every option is stored locally and applied instantly. No account, no
            cloud, no telemetry leaves this machine.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-space-base xl:grid-cols-4">
        {/* Nav */}
        <aside className="flex h-max flex-col gap-1 rounded-xl bg-surface-container-low p-space-sm shadow-md xl:sticky xl:top-4">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goToSection(item.id)}
              className={cn(
                "flex items-center gap-space-sm rounded-lg px-space-sm py-2 text-left font-label-md text-label-md transition-colors",
                activeSection === item.id
                  ? "bg-surface-container-high font-bold text-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="mt-space-sm rounded-lg border border-surface-container-highest/40 bg-surface-container-lowest px-space-sm py-2 font-code-sm text-code-sm text-on-surface-variant">
            <div className="mb-1 flex items-center gap-1.5 text-secondary">
              <span className="material-symbols-outlined text-[14px]">wifi_off</span>
              <span className="font-bold">Works offline</span>
            </div>
            <span>
              v{__APP_VERSION__} • schema v4 •{" "}
              {dbSizeBytes !== null ? `${(dbSizeBytes / 1024 / 1024).toFixed(1)} MB` : "DB —"}
            </span>
          </div>
        </aside>

        {/* Sections */}
        <div className="flex flex-col gap-space-base xl:col-span-3">
          {/* ---------------------------- Keyboard ---------------------------- */}
          <div id="settings-keyboard" onClick={() => setActiveSection("keyboard")}>
            <SectionCard
              icon="keyboard"
              title="Keyboard Layout"
              subtitle="The lesson engine is layout-agnostic; keymaps are declarative data files."
            >
              <div className="mb-space-base grid grid-cols-1 gap-space-sm md:grid-cols-3">
                <RadioCard title="QWERTY" caption="US ANSI • active" active />
                <RadioCard
                  title="DVORAK"
                  caption="keymap ready • coming soon"
                  captionTone="text-outline"
                  active={false}
                  disabled
                  onClick={() => undefined}
                />
                <RadioCard
                  title="COLEMAK"
                  caption="keymap ready • coming soon"
                  captionTone="text-outline"
                  active={false}
                  disabled
                  onClick={() => undefined}
                />
              </div>
              <ToggleRow
                label="Show finger guides"
                description="Color-code keyboard visualization by finger zones during sessions."
                checked={settings.fingerGuides}
                onChange={(fingerGuides) => update({ fingerGuides })}
              />
              <ToggleRow
                label="Highlight next key"
                description="Pulse the upcoming key on the on-screen keyboard."
                checked={settings.highlightNextKey}
                onChange={(highlightNextKey) => update({ highlightNextKey })}
              />
              <SettingRow
                label="QWERTY reference offset"
                description="Physical layout variant used for symbol position hints."
              >
                <Select
                  label="QWERTY reference offset"
                  value={settings.referenceOffset}
                  onChange={(referenceOffset) =>
                    update({ referenceOffset: referenceOffset as typeof settings.referenceOffset })
                  }
                  options={[
                    { id: "ansi", label: "US ANSI (101-key)" },
                    { id: "iso", label: "ISO (105-key)" },
                    { id: "compact60", label: "60%" },
                  ]}
                />
              </SettingRow>
            </SectionCard>
          </div>

          {/* ---------------------------- Appearance -------------------------- */}
          <div id="settings-appearance" onClick={() => setActiveSection("appearance")}>
            <SectionCard icon="palette" title="Appearance">
              <SettingRow
                label="Theme"
                description="TypeKernel dark is the designed default."
              >
                <PillGroup<ThemeId>
                  label="Theme"
                  value={settings.theme}
                  onChange={(theme) => update({ theme })}
                  options={THEMES}
                />
              </SettingRow>
              <SettingRow
                label="Editor font"
                description="Used for lesson buffers and code content."
              >
                <Select
                  label="Editor font"
                  value={settings.editorFont}
                  onChange={(editorFont) => update({ editorFont: editorFont as typeof settings.editorFont })}
                  options={[
                    { id: "jetbrains-mono", label: "JetBrains Mono (bundled)" },
                    { id: "fira-code", label: "Fira Code (not bundled)" },
                    { id: "cascadia-code", label: "Cascadia Code (not bundled)" },
                  ]}
                  disabledValues={["fira-code", "cascadia-code"]}
                />
              </SettingRow>
              <SettingRow
                label="Tab size"
                description="Spaces written for each tab when pasting code into a custom lesson."
              >
                <PillGroup<"2" | "4">
                  label="Tab size"
                  value={settings.tabSize === 2 ? "2" : "4"}
                  onChange={(tabSize) => update({ tabSize: Number(tabSize) as 2 | 4 })}
                  options={[
                    { id: "2", label: "2 spaces" },
                    { id: "4", label: "4 spaces" },
                  ]}
                />
              </SettingRow>
              <ToggleRow
                label="Reduce motion"
                description="Disables pulses, glow animation and cursor blink."
                checked={settings.reduceMotion}
                onChange={(reduceMotion) => update({ reduceMotion })}
              />
              <ToggleRow
                label="Zen / Focus Mode"
                description="Expands the code buffer to the full viewport and collapses the sidebar and keyboard. Toggled live with Ctrl+Shift+F."
                checked={settings.zenMode}
                onChange={(zenMode) => update({ zenMode })}
              />
              <ToggleRow
                label="Whitespace glyphs"
                description="Faint · indent dots and ⏎ newline markers inside the typing buffer."
                checked={settings.whitespaceGlyphs}
                onChange={(whitespaceGlyphs) => update({ whitespaceGlyphs })}
              />
            </SectionCard>
          </div>

          {/* ------------------------ Training preferences -------------------- */}
          <div id="settings-training" onClick={() => setActiveSection("training")}>
            <SectionCard icon="tune" tone="text-secondary" title="Training Preferences">
              <SettingRow
                label={
                  <>
                    Strict mode
                    <span className="ml-1">
                      <StatusPill tone="inProgress">Gate</StatusPill>
                    </span>
                  </>
                }
                description={`Unlock requirement: accuracy ≥ ${ACCURACY_GATE}% AND WPM > ${WPM_GATE} in one attempt. Fixed values are marked.`}
              >
                <StatusPill tone="locked">Locked</StatusPill>
              </SettingRow>
              <SettingRow
                label="Backspace policy"
                description="How corrections are treated in scoring and statistics."
              >
                <PillGroup
                  label="Backspace policy"
                  value={settings.backspacePolicy}
                  onChange={(backspacePolicy) => update({ backspacePolicy })}
                  options={[
                    { id: "counted", label: "Counted" },
                    { id: "free", label: "Free" },
                    { id: "forbidden", label: "Forbidden" },
                  ]}
                />
              </SettingRow>
              <ToggleRow
                label="Adaptive lessons"
                description="Inject weak keys/patterns into future exercise content."
                checked={settings.adaptiveLessons}
                onChange={(adaptiveLessons) => update({ adaptiveLessons })}
              />
              <SettingRow
                label="Daily goals"
                description="Lightweight consistency targets shown on the dashboard. A target of 0 disables that goal — a day's goals are met when every enabled goal is reached."
              >
                <DailyGoalInputs />
              </SettingRow>
              <ToggleRow
                label="Sound feedback"
                description="Keypress and error cues via system bell (no audio assets)."
                checked={settings.soundFeedback}
                onChange={(soundFeedback) => update({ soundFeedback })}
              />
            </SectionCard>
          </div>

          {/* ---------------------------- Statistics -------------------------- */}
          <div id="settings-statistics" onClick={() => setActiveSection("statistics")}>
            <SectionCard icon="monitoring" title="Statistics">
              <SettingRow
                label="Default range"
                description="Range the Statistics screen opens on."
              >
                <PillGroup
                  label="Default statistics range"
                  value={settings.statsDefaultRange}
                  onChange={(statsDefaultRange) => update({ statsDefaultRange })}
                  options={[
                    { id: "30d", label: "30 days" },
                    { id: "90d", label: "90 days" },
                    { id: "all", label: "All time" },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label="Heatmap window"
                description="Rolling window of the key heatmap."
              >
                <PillGroup
                  label="Heatmap window"
                  value={settings.heatmapWindow}
                  onChange={(heatmapWindow) => update({ heatmapWindow })}
                  options={[
                    { id: "30d", label: "30 days" },
                    { id: "lifetime", label: "Lifetime" },
                  ]}
                />
              </SettingRow>
              <ToggleRow
                label="Telemetry strip"
                description="Show the symbol-latency telemetry strip on the Lessons screen."
                checked={settings.showTelemetryStrip}
                onChange={(showTelemetryStrip) => update({ showTelemetryStrip })}
              />
            </SectionCard>
          </div>

          {/* -------------------------- Data management ----------------------- */}
          <div id="settings-data" onClick={() => setActiveSection("data")}>
            <SectionCard icon="database" tone="text-error" title="Data Management">
              <div className="mb-space-base grid grid-cols-1 gap-space-sm md:grid-cols-2">
                <div className="rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest p-space-sm">
                  <div className="flex items-center gap-space-xs font-label-md text-label-md font-bold text-on-surface">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      download
                    </span>
                    Export backup
                  </div>
                  <p className="mb-space-sm mt-1 font-body-sm text-body-sm text-on-surface-variant">
                    Full JSON dump: progress, attempts, key stats, custom lessons,
                    settings. Zod-schema versioned.
                  </p>
                  <KernelButton onClick={() => void exportBackup()}>Export JSON</KernelButton>
                  <p className="mt-space-sm text-xs text-on-surface-variant">
                    {settings.lastBackupAt !== null
                      ? `last backup ${new Date(settings.lastBackupAt).toLocaleString()}`
                      : "no backup yet"}
                  </p>
                </div>
                <div className="rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest p-space-sm">
                  <div className="flex items-center gap-space-xs font-label-md text-label-md font-bold text-on-surface">
                    <span className="material-symbols-outlined text-[16px] text-secondary">
                      upload
                    </span>
                    Import backup
                  </div>
                  <p className="mb-space-sm mt-1 font-body-sm text-body-sm text-on-surface-variant">
                    Validated before merge — invalid files are rejected and never
                    touch the database.
                  </p>
                  <KernelButton onClick={() => void startBackupImport()}>
                    Choose File…
                  </KernelButton>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-error/40 bg-surface-container-lowest p-space-sm">
                <div>
                  <div className="flex items-center gap-space-xs font-label-md text-label-md font-bold text-error">
                    <span className="material-symbols-outlined text-[16px]">dangerous</span>
                    Reset all local data
                  </div>
                  <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                    Wipes progress, attempts, key statistics and settings. Requires
                    typed confirmation. Export first — this cannot be undone.
                  </p>
                  {resetError !== null && (
                    <p className="mt-1 font-code-sm text-code-sm text-error">{resetError}</p>
                  )}
                </div>
                <KernelButton variant="danger" onClick={() => setResetOpen(true)}>
                  Reset…
                </KernelButton>
              </div>
            </SectionCard>
          </div>

          {/* -------------------------- Application --------------------------- */}
          <div id="settings-application" onClick={() => setActiveSection("application")}>
            <SectionCard icon="app_settings_alt" tone="text-outline" title="Application Behavior">
              <SettingRow
                label="Launch behavior"
                description="Where the app opens on start."
              >
                <PillGroup
                  label="Launch behavior"
                  value={settings.launchBehavior}
                  onChange={(launchBehavior) => update({ launchBehavior })}
                  options={[
                    { id: "dashboard", label: "Dashboard" },
                    { id: "current-lesson", label: "Current Lesson" },
                    { id: "last-screen", label: "Last Screen" },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label="Check for updates"
                description="Only when you click — the app never phones home on its own."
              >
                <KernelButton
                  icon="sync"
                  onClick={() => {
                    void checkForUpdates().then((opened) =>
                      setUpdateNote(
                        opened
                          ? "Opening the releases page in your browser…"
                          : "Unavailable outside the Tauri runtime.",
                      ),
                    );
                  }}
                >
                  Check Now
                </KernelButton>
              </SettingRow>
              {updateNote !== null && (
                <p className="px-1 font-code-sm text-code-sm text-secondary">{updateNote}</p>
              )}
              <SettingRow
                label={updateVersion}
                description="All data local • SQLite (WAL) • offline by design"
              >
                <span className="flex items-center gap-1 font-code-sm text-code-sm font-bold text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
                  All local
                </span>
              </SettingRow>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* --------------------------------- modals ------------------------------ */}
      {importState.phase === "confirm" && (
        <TypedConfirmModal
          title="Restore backup — REPLACE ALL data?"
          confirmWord="REPLACE"
          actionLabel="Restore backup"
          busy={importState.phase !== "confirm"}
          onConfirm={() => void confirmImport()}
          onClose={() => setImportState({ phase: "idle" })}
          description={
            <div className="flex flex-col gap-space-sm">
              <pre className="whitespace-pre-wrap font-code-sm text-code-sm text-on-surface">
                {importState.report.join("\n")}
              </pre>
              <p className="text-error">
                Restoring replaces EVERYTHING: progress, attempts, key statistics,
                custom lessons and settings. Type REPLACE to continue.
              </p>
            </div>
          }
        />
      )}

      {importState.phase === "report" && (
        <Modal
          title="Import preview"
          onClose={() => setImportState({ phase: "idle" })}
          actions={
            <>
              <KernelButton onClick={() => setImportState({ phase: "idle" })}>Cancel</KernelButton>
              <KernelButton variant="primary" onClick={() => void confirmImport()}>
                Import
              </KernelButton>
            </>
          }
        >
          <pre className="whitespace-pre-wrap font-code-sm text-code-sm text-on-surface">
            {importState.report.join("\n")}
          </pre>
        </Modal>
      )}

      {importState.phase === "busy" && (
        <Modal title="Importing…" onClose={() => setImportState({ phase: "idle" })}>
          <p className="font-code-sm text-code-sm">Applying the import in one atomic transaction…</p>
        </Modal>
      )}

      {importState.phase === "error" && (
        <Modal
          title={importState.title}
          tone="danger"
          onClose={() => setImportState({ phase: "idle" })}
          actions={<KernelButton onClick={() => setImportState({ phase: "idle" })}>Close</KernelButton>}
        >
          <ul className="list-disc space-y-1 pl-4 font-code-sm text-code-sm text-error">
            {importState.issues.map((issue, index) => (
              <li key={index} className="whitespace-pre-wrap text-left">
                {issue}
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {importState.phase === "success" && (
        <Modal
          title="Done"
          onClose={() => setImportState({ phase: "idle" })}
          actions={
            <KernelButton variant="primary" onClick={() => setImportState({ phase: "idle" })}>
              OK
            </KernelButton>
          }
        >
          <p className="font-code-sm text-code-sm text-on-surface">{importState.message}</p>
        </Modal>
      )}

      {resetOpen && (
        <TypedConfirmModal
          title="Reset all local data?"
          confirmWord="RESET"
          actionLabel="Wipe and re-seed"
          busy={resetBusy}
          onConfirm={() => void performReset()}
          onClose={() => setResetOpen(false)}
          description={
            <p>
              The SQLite database is deleted and re-created from the migrations:
              progress, attempts, key statistics, custom lessons and settings are
              gone. The curriculum is re-seeded automatically. Export a backup
              first — this cannot be undone.
            </p>
          }
        />
      )}
    </main>
  );
}

/* ------------------------- daily goal inputs (§18) ------------------------ */

/** The three §18 goal inputs: key, accessible label, unit and Zod max. */
const GOAL_FIELDS = [
  { key: "minutesGoal", label: "Daily minutes goal", unit: "min/day", name: "Minutes", max: 480 },
  { key: "lessonsGoal", label: "Daily lessons goal", unit: "lessons", name: "Lessons", max: 100 },
  { key: "charsGoal", label: "Daily characters goal", unit: "chars", name: "Characters", max: 100000 },
] as const;

/**
 * Editable daily goals (Phase 8 plan §3.2): the design's inline number
 * fields, Zod-validated (0–480 min, 0–100 lessons, 0–100k chars) with instant
 * persist through the Phase 7 store pattern. 0 disables a goal. Invalid
 * input surfaces inline and never reaches the store (§23).
 */
function DailyGoalInputs() {
  const goals = useDailyGoalsStore((s) => s.goals);
  const update = useDailyGoalsStore((s) => s.update);
  const [draft, setDraft] = useState({
    minutesGoal: String(goals.minutesGoal),
    lessonsGoal: String(goals.lessonsGoal),
    charsGoal: String(goals.charsGoal),
  });
  const [error, setError] = useState<string | null>(null);

  // Re-sync after hydration / external changes (backup restore, reset).
  useEffect(() => {
    setDraft({
      minutesGoal: String(goals.minutesGoal),
      lessonsGoal: String(goals.lessonsGoal),
      charsGoal: String(goals.charsGoal),
    });
  }, [goals]);

  const commit = (field: (typeof GOAL_FIELDS)[number], raw: string) => {
    setDraft((current) => ({ ...current, [field.key]: raw }));
    if (!/^\d+$/.test(raw.trim())) {
      setError("Goals must be whole numbers (0 disables).");
      return;
    }
    try {
      update({ [field.key]: Number(raw.trim()) });
      setError(null);
    } catch {
      setError(`${field.name} must be within 0–${field.max} (0 disables).`);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-space-sm">
        {GOAL_FIELDS.map((field, index) => (
          <span key={field.key} className="flex items-center gap-space-sm">
            {index > 0 && <span className="text-outline">•</span>}
            <label className="flex items-center gap-1.5 font-code-md text-code-md text-on-surface-variant">
              <input
                type="number"
                min={0}
                max={field.max}
                step={1}
                aria-label={field.label}
                value={draft[field.key]}
                onChange={(event) => commit(field, event.target.value)}
                className="w-20 rounded border border-surface-container-highest/50 bg-surface-container px-2 py-1 text-center text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
              />
              {field.unit}
            </label>
          </span>
        ))}
      </div>
      {error !== null ? (
        <p role="alert" className="mt-1 font-code-sm text-code-sm text-error">
          {error}
        </p>
      ) : (
        <p className="mt-1 font-code-sm text-code-sm text-outline">
          0 disables a goal — disabled goals leave the met calculation.
        </p>
      )}
    </div>
  );
}
