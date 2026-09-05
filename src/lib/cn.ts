/**
 * Minimal className joiner (clsx-style) — avoids a dependency; codebase has
 * no tailwind-merge requirement since classes don't conflict dynamically.
 */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
