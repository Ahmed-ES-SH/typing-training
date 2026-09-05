import { ScreenStub } from "../components/ScreenStub";

/**
 * Stub — Statistics (WPM/accuracy charts, per-lesson performance, key
 * heatmap and raw attempt history).
 * Design: `screens/statistics_typekernel/` — implemented in Phase 5.
 */
export default function StatisticsScreen() {
  return (
    <ScreenStub
      screenId="statistics"
      phase={5}
      description="Performance analytics: charts, per-lesson progression, key heatmap and the raw attempt history table."
    />
  );
}
