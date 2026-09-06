import { KeyHeatmap } from "./KeyHeatmap";

/**
 * Compact in-session heatmap (Phase 6 plan §3.5): the same cells as the
 * Statistics keyboard, smaller, without legend or summary cards. Rendered
 * inside the Typing Session sidebar toggle to surface weak keys during
 * practice — purely presentational, never steals keystroke focus.
 */
export function KeyHeatmapCompact(props: Omit<Parameters<typeof KeyHeatmap>[0], "compact">) {
  return <KeyHeatmap {...props} compact />;
}
