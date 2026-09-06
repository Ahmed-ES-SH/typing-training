import { useEffect, useMemo, useRef, useState } from "react";

import {
  Field,
  KernelButton,
  PillGroup,
  Slider,
} from "../components/FormPrimitives";
import { Modal } from "../components/Modal";
import { useCustomLessonsStore } from "../stores/useCustomLessonsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { detectTargets, toCurriculumLesson } from "../lib/customLessons/domain";
import { z } from "zod";
import {
  buildCollectionEnvelope,
  buildCustomLessonsEnvelope,
  backupFilename,
  serializeEnvelope,
} from "../lib/io/exporter";
import {
  applyEnvelope,
  crossRowIssues,
  importReport,
  parseEnvelope,
  planMerge,
  type CollisionStrategy,
} from "../lib/io/importer";
import {
  CustomLessonDifficultySchema,
  CustomLessonSchema,
  type CustomLesson,
} from "../lib/schemas";
import type { ExportEnvelope } from "../lib/io/exportSchema";
import { readTextFileViaDialog, saveTextFile } from "../lib/io/fileIo";
import { cn } from "../lib/cn";
import { useSessionStore } from "../stores/useSessionStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Custom Lessons — "Module Forge" (§16, §17), implemented from
 * `screens/custom_lessons_typekernel/code.html`. Author / import / export /
 * practice user-defined modules; everything stays on-disk and every import
 * is Zod-validated before it can touch the database (§23).
 */

type FilterId = "all" | "practiced" | "drafts" | "imported";
type CustomLessonDifficulty = z.infer<typeof CustomLessonDifficultySchema>;

const DIFFICULTIES: { id: CustomLessonDifficulty; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

const SYNTAX_FAMILIES = ["TypeScript", "JavaScript", "Python", "SQL", "YAML", "Shell", "Other"];

interface FormState {
  /** Present while editing an existing module. */
  id: string | null;
  title: string;
  description: string;
  content: string;
  difficulty: z.infer<typeof CustomLessonDifficultySchema>;
  syntaxFamily: string;
  wpmTarget: number;
  accuracyTarget: number;
  targetKeys: string[];
  targetSymbols: string[];
  /** False while detection tracks the content; a manual chip edit flips it. */
  manualTargets: boolean;
  isDraft: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  title: "",
  description: "",
  content: "",
  difficulty: "medium",
  syntaxFamily: "TypeScript",
  wpmTarget: 0,
  accuracyTarget: 0,
  targetKeys: [],
  targetSymbols: [],
  manualTargets: false,
  isDraft: false,
};

/** Placeholder id used for live schema validation of unsaved modules. */
const DRAFT_ID = "00000000-0000-4000-8000-000000000000";

function formToModule(form: FormState, now = Date.now()): CustomLesson {
  return CustomLessonSchema.parse({
    id: form.id ?? DRAFT_ID,
    title: form.title.trim() || "Untitled module",
    description: form.description.trim(),
    content: form.content,
    difficulty: form.difficulty,
    targetKeys: form.targetKeys,
    targetSymbols: form.targetSymbols,
    wpmTarget: form.wpmTarget > 0 ? form.wpmTarget : null,
    accuracyTarget: form.accuracyTarget > 0 ? form.accuracyTarget : null,
    isDraft: form.isDraft,
    source: "custom",
    collectionId: null,
    syntaxFamily: form.syntaxFamily,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Debounced Zod check for the live `SCHEMA VALID ✓` indicator. */
function useFormValidation(form: FormState): { valid: boolean; issues: string[] } {
  const [result, setResult] = useState<{ valid: boolean; issues: string[] }>({
    valid: false,
    issues: [],
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      if (form.title.trim().length === 0 || form.content.trim().length === 0) {
        setResult({ valid: false, issues: ["title and content are required"] });
        return;
      }
      const parsed = CustomLessonSchema.safeParse(formToModule(form));
      setResult(
        parsed.success
          ? { valid: true, issues: [] }
          : { valid: false, issues: parsed.error.issues.map((i) => i.message) },
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [form]);
  return result;
}

/* ------------------------------- module cards ------------------------------ */

const DIFFICULTY_LABEL: Record<CustomLessonDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

function ContentPreview({ content }: { content: string }) {
  const firstLine = content.split("\n")[0] ?? "";
  return (
    <div className="mb-space-sm truncate rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest/80 p-2 font-code-md text-code-md text-on-surface">
      {firstLine}
    </div>
  );
}

function ModuleCard({
  lesson,
  stats,
  onPractice,
  onEdit,
  onDelete,
}: {
  lesson: CustomLesson;
  stats: { attempts: number; bestWpm: number };
  onPractice: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sourceLabel = lesson.isDraft
    ? `DRAFT // ${lesson.syntaxFamily.toUpperCase() || "CODE"}`
    : lesson.source === "imported"
      ? "IMPORTED // COLLECTION"
      : `CUSTOM // ${lesson.syntaxFamily.toUpperCase() || "CODE"}`;
  const practiced = stats.attempts > 0;

  return (
    <article
      className={cn(
        "rounded-xl border bg-surface-container-low p-space-base shadow-md transition-colors",
        practiced
          ? "border-primary-container/30 hover:border-primary-container/60"
          : "border-dashed border-surface-container-highest hover:border-surface-container-highest",
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-space-xs">
            <span
              className={cn(
                "font-code-sm tracking-wider",
                lesson.source === "imported" || lesson.isDraft
                  ? "text-outline"
                  : "text-primary",
              )}
            >
              {sourceLabel}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-label-sm text-label-sm font-bold uppercase",
                practiced
                  ? "bg-primary-container/20 text-primary"
                  : "bg-surface-container text-on-surface-variant",
              )}
            >
              {lesson.isDraft ? "Draft" : practiced ? "Practiced" : "New"}
            </span>
          </div>
          <h3 className="truncate font-headline-md text-headline-md text-on-surface">
            {lesson.title}
          </h3>
          {lesson.description.length > 0 && (
            <p className="mt-0.5 line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
              {lesson.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {practiced ? (
            <>
              <span className="font-code-sm text-code-sm font-bold text-primary">
                PB {Math.round(stats.bestWpm)} WPM
              </span>
              <span className="font-code-sm text-code-sm text-on-surface-variant">
                {stats.attempts} attempt{stats.attempts === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <span className="font-code-sm text-code-sm text-on-surface-variant">
              {lesson.isDraft ? "not practiced" : "new module"}
            </span>
          )}
        </div>
      </div>

      <ContentPreview content={lesson.content} />

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-space-xs font-code-sm text-code-sm">
          {[...lesson.targetKeys, ...lesson.targetSymbols].slice(0, 4).map((char) => (
            <span key={char} className="rounded bg-surface-container px-1.5 py-0.5 text-on-surface-variant">
              {char}
            </span>
          ))}
          <span className="rounded bg-surface-container px-1.5 py-0.5 text-on-surface-variant">
            {DIFFICULTY_LABEL[lesson.difficulty]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={lesson.isDraft ? "Publish before practicing" : "Practice"}
            disabled={lesson.isDraft}
            onClick={onPractice}
            className="rounded bg-surface-container-lowest p-1.5 text-primary transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
          </button>
          <button
            type="button"
            title="Edit"
            onClick={onEdit}
            className="rounded bg-surface-container-lowest p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button
            type="button"
            title="Delete"
            onClick={onDelete}
            className="rounded bg-surface-container-lowest p-1.5 text-error transition-colors hover:bg-error-container/30"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </div>
    </article>
  );
}

/** Expandable imported-collection card (per-module practice, plan §3.1). */
function CollectionCard({
  collectionId,
  modules,
  onPracticeModule,
  onExport,
}: {
  collectionId: string;
  modules: CustomLesson[];
  onPracticeModule: (lesson: CustomLesson) => void;
  onExport: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name =
    modules[0]?.tags.find((tag) => tag.startsWith("collection:"))?.slice("collection:".length) ??
    `Collection ${collectionId.slice(0, 8)}`;
  return (
    <article className="rounded-xl border border-transparent bg-surface-container-low p-space-base shadow-md transition-colors hover:border-surface-container-highest">
      <div className="mb-1 flex items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-space-xs">
            <span className="font-code-sm tracking-wider text-outline">
              IMPORTED // COLLECTION
            </span>
            <span className="rounded bg-surface-container px-1.5 py-0.5 font-label-sm text-label-sm font-bold uppercase text-on-surface-variant">
              Imported
            </span>
          </div>
          <h3 className="font-headline-md text-headline-md text-on-surface">{name}</h3>
          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
            Imported collection • {modules.length} module{modules.length === 1 ? "" : "s"} — expand to practice per module.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="font-code-sm text-code-sm text-on-surface-variant">
            {modules.length} modules
          </span>
          <span className="font-code-sm text-code-sm text-on-surface-variant">v1 format ✓</span>
        </div>
      </div>
      <div className="mt-space-sm flex items-center justify-between">
        <div className="flex flex-wrap gap-space-xs font-code-sm text-code-sm">
          {[...new Set(modules.flatMap((m) => [...m.targetKeys, ...m.targetSymbols]))]
            .slice(0, 3)
            .map((char) => (
              <span key={char} className="rounded bg-surface-container px-1.5 py-0.5 text-on-surface-variant">
                {char}
              </span>
            ))}
          <span className="rounded bg-surface-container px-1.5 py-0.5 text-on-surface-variant">
            Mixed
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded bg-surface-container-lowest px-space-sm py-1.5 font-label-sm text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            {expanded ? "COLLAPSE" : "EXPAND"}
          </button>
          <button
            type="button"
            title="Export collection"
            onClick={onExport}
            className="rounded bg-surface-container-lowest p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-space-sm flex flex-col gap-1 border-t border-surface-container-highest/30 pt-space-sm">
          {modules.map((module) => (
            <div
              key={module.id}
              className="flex items-center justify-between rounded bg-surface-container-lowest/70 px-space-sm py-1.5"
            >
              <span className="truncate font-code-sm text-code-sm text-on-surface">
                {module.title}
              </span>
              <button
                type="button"
                onClick={() => onPracticeModule(module)}
                className="rounded bg-surface-container px-2 py-0.5 font-label-sm text-label-sm font-bold text-primary hover:bg-surface-container-high"
              >
                PRACTICE
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* --------------------------------- the screen ------------------------------ */

export default function CustomLessonsScreen() {
  const { lessons, stats, loaded, error, load, create, update, remove } =
    useCustomLessonsStore();
  const lastBackupAt = useSettingsStore((s) => s.settings.lastBackupAt);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [chipInput, setChipInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CustomLesson | null>(null);
  const [importState, setImportState] = useState<
    | { phase: "idle" }
    | { phase: "report"; envelope: ExportEnvelope; report: string[]; strategy: CollisionStrategy }
    | { phase: "error"; title: string; issues: string[] }
    | { phase: "success"; message: string }
  >({ phase: "idle" });
  const formScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void load();
  }, [load]);


  // Auto-detection re-runs ONLY while the user has not hand-edited the
  // chips (plan §2). A manual edit flips `manualTargets` and detection stops.
  useEffect(() => {
    if (form.manualTargets) return;
    const detected = detectTargets(form.content);
    setForm((current) => {
      if (current.manualTargets) return current;
      if (
        current.targetKeys.length === detected.keys.length &&
        current.targetSymbols.length === detected.symbols.length &&
        current.targetKeys.every((key, i) => key === detected.keys[i]) &&
        current.targetSymbols.every((symbol, i) => symbol === detected.symbols[i])
      ) {
        return current;
      }
      return { ...current, targetKeys: detected.keys, targetSymbols: detected.symbols };
    });
  }, [form.content, form.manualTargets, form.targetKeys, form.targetSymbols]);

  const validation = useFormValidation(form);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  const removeChip = (char: string) => {
    patch({
      targetKeys: form.targetKeys.filter((key) => key !== char),
      targetSymbols: form.targetSymbols.filter((symbol) => symbol !== char),
      manualTargets: true,
    });
  };

  const addChip = (raw: string) => {
    const chars = Array.from(raw.trim()).filter((c) => c !== " ");
    if (chars.length === 0) return;
    const keys = new Set(form.targetKeys);
    const symbols = new Set(form.targetSymbols);
    for (const char of chars) {
      (/[a-zA-Z0-9]/.test(char) ? keys : symbols).add(char);
    }
    patch({
      targetKeys: [...keys],
      targetSymbols: [...symbols],
      manualTargets: true,
    });
  };

  /* ------------------------------ derived list ---------------------------- */

  const counts = useMemo(
    () => ({
      all: lessons.length,
      practiced: lessons.filter((l) => !l.isDraft && (stats[`custom-${l.id}`]?.attempts ?? 0) > 0).length,
      drafts: lessons.filter((l) => l.isDraft).length,
      imported: lessons.filter((l) => l.source === "imported").length,
    }),
    [lessons, stats],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lessons.filter((lesson) => {
      switch (filter) {
        case "practiced":
          if (lesson.isDraft || (stats[`custom-${lesson.id}`]?.attempts ?? 0) === 0) return false;
          break;
        case "drafts":
          if (!lesson.isDraft) return false;
          break;
        case "imported":
          if (lesson.source !== "imported") return false;
          break;
      }
      if (query.length === 0) return true;
      const haystack = [
        lesson.title,
        lesson.description,
        lesson.syntaxFamily,
        ...lesson.tags,
        ...lesson.targetKeys,
        ...lesson.targetSymbols,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [lessons, stats, search, filter]);

  const collections = useMemo(() => {
    const grouped = new Map<string, CustomLesson[]>();
    for (const lesson of filtered) {
      if (lesson.source === "imported" && lesson.collectionId !== null) {
        grouped.set(lesson.collectionId, [...(grouped.get(lesson.collectionId) ?? []), lesson]);
      }
    }
    return grouped;
  }, [filtered]);
  const collectionIds = new Set(collections.keys());

  /* -------------------------------- actions ------------------------------- */

  const openNewForm = () => {
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
    formScrollRef.current?.scrollTo({ top: 0 });
  };

  const openEditForm = (lesson: CustomLesson) => {
    setForm({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      content: lesson.content,
      difficulty: lesson.difficulty,
      syntaxFamily: lesson.syntaxFamily.length > 0 ? lesson.syntaxFamily : "Other",
      wpmTarget: lesson.wpmTarget ?? 0,
      accuracyTarget: lesson.accuracyTarget ?? 0,
      targetKeys: lesson.targetKeys,
      targetSymbols: lesson.targetSymbols,
      manualTargets: true,
      isDraft: lesson.isDraft,
    });
    setFormOpen(true);
  };

  const practice = (lesson: CustomLesson) => {
    const curriculum = toCurriculumLesson(lesson);
    useSessionStore.getState().reset();
    useUiStore.getState().navigate("typing-session", {
      "typing-session": { lessonId: curriculum.id },
    });
  };

  const saveForm = async (asDraft: boolean) => {
    const state: FormState = { ...form, isDraft: asDraft };
    if (!validation.valid && state.content.trim().length > 0 && state.title.trim().length > 0) {
      // Schema-invalid content never reaches SQL (§23) — surface the issues.
      setImportState({ phase: "error", title: "Module rejected", issues: validation.issues });
      return;
    }
    if (state.title.trim().length === 0 || state.content.trim().length === 0) {
      setImportState({
        phase: "error",
        title: "Module rejected",
        issues: ["title and content are required"],
      });
      return;
    }
    const module = formToModule(state);
    if (state.id !== null) {
      const { id: _sameId, createdAt: _createdAt, ...modulePatch } = module;
      void _sameId;
      void _createdAt;
      await update(state.id, modulePatch);
    } else {
      await create(module);
    }
    setFormOpen(false);
    setForm(EMPTY_FORM);
  };

  const exportAll = async () => {
    const text = serializeEnvelope(
      buildCustomLessonsEnvelope(lessons, { exportedAt: Date.now() }),
    );
    const path = await saveTextFile(backupFilename("custom-lessons"), text);
    if (path !== null) {
      setImportState({
        phase: "success",
        message: `Exported ${lessons.length} module(s) to ${path}`,
      });
    }
  };

  const exportCollection = async (collectionId: string, modules: CustomLesson[]) => {
    const text = serializeEnvelope(
      buildCollectionEnvelope(modules, collectionId, modules[0]?.title ?? "Collection", {
        exportedAt: Date.now(),
      }),
    );
    const path = await saveTextFile(backupFilename("collection"), text);
    if (path !== null) {
      setImportState({ phase: "success", message: `Exported ${modules.length} module(s) to ${path}` });
    }
  };

  const startImport = async () => {
    const picked = await readTextFileViaDialog();
    if (picked === null) return; // dialog cancelled / unavailable outside Tauri
    const parsed = parseEnvelope(picked.contents);
    if (!parsed.ok) {
      setImportState({
        phase: "error",
        title: `Invalid file: ${picked.path.split("/").pop() ?? picked.path}`,
        issues: parsed.issues,
      });
      return;
    }
    const envelope = parsed.envelope;
    if (envelope.kind === "progress-backup") {
      setImportState({
        phase: "error",
        title: "Wrong file kind",
        issues: [
          "This is a progress BACKUP — import it from Settings → Data Management (it replaces all local data).",
        ],
      });
      return;
    }
    const rowIssues = crossRowIssues(envelope);
    if (rowIssues.length > 0) {
      setImportState({ phase: "error", title: "Invalid file", issues: rowIssues });
      return;
    }
    const plan = planMerge(lessons, envelope.payload.lessons);
    setImportState({
      phase: "report",
      envelope,
      strategy: "keep-newer",
      report: importReport(envelope, plan),
    });
  };

  const confirmImport = async () => {
    if (importState.phase !== "report") return;
    try {
      const plan = await applyEnvelope(importState.envelope, {
        strategy: importState.strategy,
      });
      await load();
      setImportState({
        phase: "success",
        message: importState.envelope.kind === "collection"
          ? `Collection imported: ${"added" in plan && Array.isArray(plan.added) ? plan.added.length : 0} module(s) added.`
          : "Modules imported.",
      });
    } catch (error) {
      setImportState({
        phase: "error",
        title: "Import rejected",
        issues: [error instanceof Error ? error.message : String(error)],
      });
    }
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    await remove(deleteTarget.id);
    setDeleteTarget(null);
  };

  /* --------------------------------- render -------------------------------- */

  const setStrategy = (strategy: CollisionStrategy) => {
    if (importState.phase === "report") setImportState({ ...importState, strategy });
  };

  return (
    <main className="flex w-full flex-1 gap-space-sm overflow-hidden bg-surface p-space-sm sm:p-space-base sm:gap-space-base">
      {/* ------------------------------ left column ------------------------- */}
      <section className="flex min-w-0 flex-1 flex-col gap-space-sm overflow-y-auto pb-space-base">
        {/* Hero */}
        <div className="relative w-full overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-xl">
          <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-primary-container/10 blur-3xl" />
          <div className="relative z-10 flex flex-col justify-between gap-space-base lg:flex-row lg:items-center">
            <div>
              <div className="mb-space-xs flex items-center gap-space-xs">
                <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-high px-space-xs py-space-2xs font-code-sm text-code-sm uppercase tracking-wider text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-container animate-pulse" />
                  CUSTOM MODULES // LOCAL JSON
                </span>
              </div>
              <h1 className="font-display-lg text-display-lg tracking-tight text-on-surface">
                Module Forge
              </h1>
              <p className="mt-space-xs max-w-xl font-body-md text-body-md text-on-surface-variant">
                Author, import, and drill your own lesson modules. Everything stays
                on-disk — validated with strict schemas before it ever reaches the
                database.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              <KernelButton icon="upload" onClick={() => void startImport()}>
                Import JSON
              </KernelButton>
              <KernelButton icon="download" onClick={() => void exportAll()}>
                Export All
              </KernelButton>
              <KernelButton variant="primary" icon="add" onClick={openNewForm}>
                New Lesson
              </KernelButton>
            </div>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-space-sm">
          <div className="relative max-w-md flex-1">
            <span className="material-symbols-outlined absolute left-space-sm top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search custom modules by title, tag, or target key..."
              className="w-full rounded-lg bg-surface-container-lowest py-2 pl-10 pr-space-base font-code-md text-code-md text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:bg-surface-container focus:outline-none focus:ring-1 focus:ring-primary-container"
            />
          </div>
          <PillGroup<FilterId>
            label="Module filters"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: `All (${counts.all})` },
              { id: "practiced", label: `Practiced (${counts.practiced})` },
              { id: "drafts", label: `Drafts (${counts.drafts})` },
              { id: "imported", label: `Imported (${counts.imported})` },
            ]}
          />
        </div>

        {error !== null && (
          <div className="rounded-lg border border-error/40 bg-error-container/20 px-space-base py-space-sm font-body-sm text-body-sm text-error">
            {error}
          </div>
        )}

        {/* Cards */}
        {loaded && filtered.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-surface-container-highest/50 bg-surface-container-lowest/40 p-space-lg text-center">
            <span className="material-symbols-outlined text-[36px] text-outline">construction</span>
            <p className="mt-2 font-headline-md text-headline-md text-on-surface">
              No modules here yet
            </p>
            <p className="mt-1 max-w-md font-body-sm text-body-sm text-on-surface-variant">
              {lessons.length === 0
                ? "Forge your first module with New Lesson, or import a JSON collection."
                : "No module matches the current search/filter."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-space-sm xl:grid-cols-2">
            {[...collections.entries()].map(([collectionId, modules]) => (
              <CollectionCard
                key={collectionId}
                collectionId={collectionId}
                modules={modules}
                onPracticeModule={practice}
                onExport={() => void exportCollection(collectionId, modules)}
              />
            ))}
            {filtered
              .filter(
                (lesson) =>
                  !(lesson.source === "imported" && lesson.collectionId !== null) ||
                  !collectionIds.has(lesson.collectionId as string),
              )
              .map((lesson) => (
                <ModuleCard
                  key={lesson.id}
                  lesson={lesson}
                  stats={stats[`custom-${lesson.id}`] ?? { attempts: 0, bestWpm: 0, bestAccuracy: 0 }}
                  onPractice={() => practice(lesson)}
                  onEdit={() => openEditForm(lesson)}
                  onDelete={() => setDeleteTarget(lesson)}
                />
              ))}
          </div>
        )}

        {lastBackupAt !== null && (
          <div className="px-1 font-code-sm text-[10px] uppercase tracking-wider text-outline">
            last backup {new Date(lastBackupAt).toLocaleString()}
          </div>
        )}
      </section>

      {/* ------------------------------ right form -------------------------- */}
      {formOpen && (
        <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-xl border border-primary-container/40 bg-surface-container-low shadow-2xl">
          <div className="flex items-center justify-between border-b border-surface-container-highest/40 p-space-base">
            <div>
              <span className="font-code-sm text-code-sm font-bold tracking-wider text-primary">
                {form.id === null ? "NEW MODULE // FORM" : "EDIT MODULE // FORM"}
              </span>
              <h2 className="mt-0.5 font-headline-md text-headline-md tracking-tight text-on-surface">
                {form.id === null ? "Create Custom Lesson" : `Edit: ${form.title || "…"}`}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close form"
              onClick={() => setFormOpen(false)}
              className="rounded bg-surface-container-lowest p-1.5 text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div ref={formScrollRef} className="flex flex-1 flex-col gap-space-base overflow-y-auto p-space-base">
            <Field label="Title" required>
              <input
                value={form.title}
                onChange={(event) => patch({ title: event.target.value })}
                placeholder="React Hook Signatures"
                className="w-full rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest px-space-sm py-2 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
              />
            </Field>

            <Field label="Description">
              <textarea
                rows={2}
                value={form.description}
                onChange={(event) => patch({ description: event.target.value })}
                className="w-full resize-none rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest px-space-sm py-2 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
              />
            </Field>

            <Field label="Content" required>
              <textarea
                rows={5}
                value={form.content}
                onChange={(event) => patch({ content: event.target.value })}
                spellCheck={false}
                className="w-full resize-none rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest px-space-sm py-2 font-code-md leading-relaxed text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
              />
              <div className="mt-1 flex items-center justify-between font-code-sm text-code-sm">
                <span className="text-on-surface-variant">
                  {form.content.length} characters • {form.content.split("\n").length} lines
                </span>
                <span className={validation.valid ? "text-primary" : "text-outline"}>
                  {[...new Set(Array.from(form.content))].filter(
                    (c) => c !== "\n" && c !== " ",
                  ).length}{" "}
                  target keys detected
                </span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-space-sm">
              <Field label="Difficulty">
                <select
                  value={form.difficulty}
                  onChange={(event) =>
                    patch({ difficulty: event.target.value as z.infer<typeof CustomLessonDifficultySchema> })
                  }
                  className="w-full rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest px-space-sm py-2 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
                >
                  {DIFFICULTIES.map((difficulty) => (
                    <option key={difficulty.id} value={difficulty.id}>
                      {difficulty.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Syntax Family">
                <select
                  value={form.syntaxFamily}
                  onChange={(event) => patch({ syntaxFamily: event.target.value })}
                  className="w-full rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest px-space-sm py-2 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
                >
                  {SYNTAX_FAMILIES.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Target Keys / Symbols (auto-detected, editable)">
              <div className="flex flex-wrap gap-1 rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest p-2">
                {form.targetKeys.map((char) => (
                  <Chip key={`k${char}`} char={char} onRemove={() => removeChip(char)} />
                ))}
                {form.targetSymbols.map((char) => (
                  <Chip key={`s${char}`} char={char} onRemove={() => removeChip(char)} />
                ))}
                {form.targetKeys.length + form.targetSymbols.length === 0 && (
                  <span className="px-1 font-code-sm text-code-sm text-outline">
                    type content to auto-detect…
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-space-sm">
                <input
                  value={chipInput}
                  onChange={(event) => setChipInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChip(chipInput);
                      setChipInput("");
                    }
                  }}
                  placeholder="+ add key…"
                  className="w-24 rounded border border-surface-container-highest/50 bg-surface-container-lowest px-2 py-1 font-code-sm text-code-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container"
                />
                {form.manualTargets && (
                  <button
                    type="button"
                    onClick={() => {
                      const detected = detectTargets(form.content);
                      patch({ targetKeys: detected.keys, targetSymbols: detected.symbols, manualTargets: false });
                    }}
                    className="font-code-sm text-code-sm text-primary hover:underline"
                  >
                    re-detect from content
                  </button>
                )}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-space-sm">
              <Slider
                label="WPM Target"
                value={form.wpmTarget}
                min={0}
                max={120}
                onChange={(wpmTarget) => patch({ wpmTarget })}
                minLabel="none"
                maxLabel="120"
              />
              <Slider
                label="Accuracy Target"
                value={form.accuracyTarget}
                min={0}
                max={100}
                onChange={(accuracyTarget) => patch({ accuracyTarget })}
                minLabel="none"
                maxLabel="100"
                format={(value) => (value === 0 ? "none" : `${value}%`)}
                accent="accent-secondary"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-surface-container-highest/40 bg-surface-container-lowest/40 p-space-base">
            <div
              className={cn(
                "flex items-center gap-1.5 font-code-sm text-code-sm",
                validation.valid ? "text-primary" : "text-outline",
              )}
              title={validation.issues.join("\n")}
            >
              <span className="material-symbols-outlined text-[14px]">
                {validation.valid ? "check_circle" : "error"}
              </span>
              {validation.valid ? "SCHEMA VALID ✓" : "SCHEMA INCOMPLETE"}
            </div>
            <div className="flex items-center gap-space-sm">
              <KernelButton onClick={() => void saveForm(true)}>Save Draft</KernelButton>
              <KernelButton variant="primary" icon="play_arrow" onClick={() => void saveForm(false)}>
                Create & Drill
              </KernelButton>
            </div>
          </div>
        </aside>
      )}

      {/* -------------------------------- modals ----------------------------- */}
      {deleteTarget !== null && (
        <Modal
          title="Delete module?"
          tone="danger"
          onClose={() => setDeleteTarget(null)}
          actions={
            <>
              <KernelButton onClick={() => setDeleteTarget(null)}>Cancel</KernelButton>
              <KernelButton variant="danger" icon="delete" onClick={() => void confirmDelete()}>
                Delete
              </KernelButton>
            </>
          }
        >
          <p>
            <strong className="text-on-surface">{deleteTarget.title}</strong> will be removed
            from your library. Its past attempts stay in the local ledger (§10) — only the
            module row is deleted. This cannot be undone.
          </p>
        </Modal>
      )}

      {importState.phase === "report" && (
        <Modal
          title="Import preview"
          onClose={() => setImportState({ phase: "idle" })}
          actions={
            <>
              <KernelButton onClick={() => setImportState({ phase: "idle" })}>Cancel</KernelButton>
              <KernelButton variant="primary" icon="download" onClick={() => void confirmImport()}>
                Import
              </KernelButton>
            </>
          }
        >
          <div className="flex flex-col gap-space-sm">
            <pre className="whitespace-pre-wrap font-code-sm text-code-sm text-on-surface">
              {importState.report.join("\n")}
            </pre>
            <Field label="On id collision">
              <PillGroup<CollisionStrategy>
                label="Collision strategy"
                value={importState.strategy}
                onChange={setStrategy}
                options={[
                  { id: "keep-newer", label: "Keep newer" },
                  { id: "rename", label: "Import as copy" },
                ]}
              />
            </Field>
          </div>
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
          actions={<KernelButton variant="primary" onClick={() => setImportState({ phase: "idle" })}>OK</KernelButton>}
        >
          <p className="font-code-sm text-code-sm text-on-surface">{importState.message}</p>
        </Modal>
      )}
    </main>
  );
}

/* --------------------------------- chips ----------------------------------- */

function Chip({ char, onRemove }: { char: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      title="Remove"
      onClick={onRemove}
      className="rounded bg-primary-container/20 px-1.5 py-0.5 font-code-sm text-code-sm font-bold text-primary transition-colors hover:bg-error-container/40 hover:text-error"
    >
      {char} ×
    </button>
  );
}
