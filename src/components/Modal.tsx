import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { KernelButton } from "./FormPrimitives";
import { cn } from "../lib/cn";

/**
 * Terminal-modal dialog shell (Phase 7) — the confirm/report surface used by
 * Custom Lessons (delete confirm, import report) and Settings (typed-RESET
 * danger zone). Backdrop click cancels; Escape cancels.
 */
export function Modal({
  title,
  children,
  onClose,
  actions,
  tone = "default",
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  tone?: "default" | "danger";
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-space-base backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "w-full max-w-lg overflow-hidden rounded-xl border bg-surface-container-low shadow-2xl",
          tone === "danger" ? "border-error/50" : "border-primary-container/40",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between border-b px-space-base py-space-sm",
            tone === "danger"
              ? "border-error/30 bg-error-container/20"
              : "border-surface-container-highest/40 bg-surface-container-lowest/60",
          )}
        >
          <div className="flex items-center gap-space-xs">
            <span
              className={cn(
                "material-symbols-outlined text-[18px]",
                tone === "danger" ? "text-error" : "text-primary",
              )}
            >
              {tone === "danger" ? "dangerous" : "terminal"}
            </span>
            <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded bg-surface-container-lowest p-1 text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-space-base py-space-base font-body-md text-body-md text-on-surface-variant">
          {children}
        </div>
        {actions !== undefined && (
          <div className="flex items-center justify-end gap-space-sm border-t border-surface-container-highest/40 bg-surface-container-lowest/40 px-space-base py-space-sm">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/** Typed-confirmation wrapper (the §20 reset ceremony). */
export function TypedConfirmModal({
  title,
  description,
  confirmWord,
  actionLabel,
  onConfirm,
  onClose,
  busy = false,
}: {
  title: string;
  description: ReactNode;
  confirmWord: string;
  actionLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      tone="danger"
      onClose={onClose}
      actions={
        <>
          <KernelButton onClick={onClose}>Cancel</KernelButton>
          <KernelButton variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Resetting…" : actionLabel}
          </KernelButton>
        </>
      }
    >
      <div className="flex flex-col gap-space-sm">
        <div>{description}</div>
        <label className="font-code-sm text-code-sm uppercase tracking-wider text-on-surface">
          Type {confirmWord} to confirm
        </label>
        <TypedConfirmInput confirmWord={confirmWord} onConfirmed={onConfirm} busy={busy} />
      </div>
    </Modal>
  );
}

function TypedConfirmInput({
  confirmWord,
  onConfirmed,
  busy,
}: {
  confirmWord: string;
  onConfirmed: () => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const matches = value === confirmWord;
  return (
    <div className="flex items-center gap-space-sm">
      <input
        autoFocus
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches && !busy) onConfirmed();
        }}
        placeholder={confirmWord}
        className={cn(
          "w-full rounded-lg border bg-surface-container-lowest px-space-sm py-2 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1",
          matches
            ? "border-secondary/50 focus:ring-secondary"
            : "border-surface-container-highest/50 focus:ring-primary-container",
        )}
      />
      <span
        className={cn(
          "shrink-0 font-code-sm text-code-sm font-bold",
          matches ? "text-secondary" : "text-outline",
        )}
      >
        {matches ? "CONFIRMED ✓" : "…"}
      </span>
    </div>
  );
}
