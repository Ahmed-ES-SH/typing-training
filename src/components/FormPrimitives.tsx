import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Shared TypeKernel form primitives (Phase 7) — the row/section/toggle/slider
 * language of the `settings_typekernel` and `custom_lessons_typekernel`
 * designs, extracted once so both screens (and Phase 8's daily-goal editor)
 * reuse the same building blocks.
 */

/* --------------------------------- rows ---------------------------------- */

/** One settings row: bold label + description on the left, control on the
 * right, on the lowest surface with the design's hairline border. */
export function SettingRow({
  label,
  description,
  badge,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** Small chip after the label (e.g. the strict-mode GATE marker). */
  badge?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-space-base rounded-lg border border-surface-container-highest/30 bg-surface-container-lowest px-space-base py-space-sm",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="font-label-md text-label-md font-bold text-on-surface">
          {label}
          {badge !== undefined && <span className="ml-1 align-middle">{badge}</span>}
        </div>
        {description !== undefined && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">{description}</p>
        )}
      </div>
      {children !== undefined && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/* -------------------------------- sections ------------------------------- */

/** A whole section card with the design's icon + headline header. */
export function SectionCard({
  icon,
  tone = "text-primary",
  title,
  subtitle,
  children,
  id,
}: {
  icon: string;
  tone?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-xl bg-surface-container-low p-space-base shadow-md">
      <h2 className="mb-space-sm flex items-center gap-space-xs font-headline-lg text-headline-lg text-on-surface">
        <span className={cn("material-symbols-outlined text-[22px]", tone)}>{icon}</span>
        {title}
      </h2>
      {subtitle !== undefined && (
        <p className="mb-space-base font-body-sm text-body-sm text-on-surface-variant">
          {subtitle}
        </p>
      )}
      <div className="flex flex-col gap-space-sm">{children}</div>
    </section>
  );
}

/* -------------------------------- toggles -------------------------------- */

/** The design's 44x24 pill toggle. */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary-container" : "bg-surface-container-highest",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-4 w-4 rounded-full transition-all",
          checked ? "left-6 bg-on-primary" : "left-1 bg-on-surface-variant",
        )}
      />
    </button>
  );
}

/** A SettingRow whose control is a Toggle. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} description={description}>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </SettingRow>
  );
}

/* ------------------------------- pill groups ------------------------------ */

/** Segmented control of the design (theme pills, backspace policy, launch). */
export function PillGroup<T extends string>({
  value,
  options,
  onChange,
  disabledValues,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
  disabledValues?: T[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-1 rounded-lg bg-surface-container p-1 font-label-sm text-label-sm"
    >
      {options.map((option) => {
        const disabled = disabledValues?.includes(option.id) ?? false;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded px-space-sm py-1 transition-colors",
              value === option.id
                ? "bg-primary-container font-bold text-on-primary-container"
                : "text-on-surface-variant hover:text-on-surface",
              disabled && "cursor-not-allowed opacity-40 hover:text-on-surface-variant",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- slider -------------------------------- */

/** Range slider with the design's live value read-out + end labels. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  minLabel,
  maxLabel,
  format,
  accent = "accent-primary",
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
  minLabel?: string;
  maxLabel?: string;
  format?: (value: number) => string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-surface-container-highest/50 bg-surface-container-lowest p-space-sm">
      <div className="mb-1 flex items-center justify-between font-code-sm text-code-sm">
        <span className="uppercase text-on-surface-variant">{label}</span>
        <span className="font-bold text-primary">
          {format !== undefined ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn("w-full", accent)}
      />
      {(minLabel !== undefined || maxLabel !== undefined) && (
        <div className="flex justify-between font-code-sm text-[10px] text-outline">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- radio cards ------------------------------ */

/** The keyboard-layout radio cards (active bordered, others muted). */
export function RadioCard({
  title,
  caption,
  active,
  disabled = false,
  onClick,
  captionTone,
}: {
  title: string;
  caption: ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  captionTone?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border p-space-sm text-left transition-opacity",
        active
          ? "border-primary-container bg-primary-container/10 ring-1 ring-primary-container/40"
          : "border-surface-container-highest/50",
        disabled && "cursor-not-allowed opacity-60 hover:opacity-90",
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            "font-headline-md text-headline-md font-bold",
            active ? "text-primary" : "text-on-surface-variant",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "material-symbols-outlined text-[20px]",
            active ? "text-primary" : "text-on-surface-variant",
          )}
          style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {active ? "radio_button_checked" : "radio_button_unchecked"}
        </span>
      </div>
      <p className={cn("font-code-sm text-code-sm", captionTone ?? "text-on-surface-variant")}>
        {caption}
      </p>
    </button>
  );
}

/* -------------------------------- selects -------------------------------- */

/** The design's dark select box (editor font, reference offset). */
export function Select({
  value,
  options,
  onChange,
  label,
  disabledValues,
  className,
}: {
  value: string;
  options: { id: string; label: string; disabled?: boolean }[];
  onChange: (next: string) => void;
  label: string;
  disabledValues?: string[];
  className?: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "rounded-lg border border-surface-container-highest/50 bg-surface-container px-space-sm py-1.5 font-code-md text-code-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary-container",
        className,
      )}
    >
      {options.map((option) => (
        <option
          key={option.id}
          value={option.id}
          disabled={disabledValues?.includes(option.id) ?? option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* -------------------------------- buttons -------------------------------- */

/** Design button variants used across both screens. */
export function KernelButton({
  children,
  onClick,
  variant = "ghost",
  icon,
  className,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  icon?: string;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-space-xs rounded-lg px-space-base py-2 font-label-md transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-primary-container font-bold tracking-wide text-on-primary-container shadow-lg hover:bg-secondary-container",
        variant === "ghost" &&
          "border border-surface-container-highest bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
        variant === "danger" &&
          "bg-error-container font-bold text-on-error-container hover:bg-error-container/80",
        className,
      )}
    >
      {icon !== undefined && (
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      )}
      {children}
    </button>
  );
}

/** Label + input wrapper of the module form. */
export function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
        {label}
        {required && " *"}
      </label>
      {children}
    </div>
  );
}
