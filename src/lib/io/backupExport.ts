import { useSettingsStore } from "../../stores/useSettingsStore";
import { backupFilename, collectBackup, serializeEnvelope } from "./exporter";
import { inTauri, saveTextFile } from "./fileIo";

/** Status line for browser dev: the native save dialog only exists in Tauri. */
export const EXPORT_UNSUPPORTED_MESSAGE = "Export is available in the desktop app";

/**
 * §5.2.4 "Export Backup JSON" — the Settings screen's export flow extracted
 * so the command palette can run the exact same one (collect envelope →
 * native save dialog → stamp `lastBackupAt`) without duplicating it.
 *
 * Returns the written path, or `null` when the dialog was cancelled.
 * Outside Tauri the flow RE-THROWS `EXPORT_UNSUPPORTED_MESSAGE` (a null there
 * would be indistinguishable from a cancel and leave callers silent).
 * Failures are RE-THROWN: the caller owns the messaging — Settings keeps its
 * success/error report, the palette shows an inline error and stays open.
 */
export async function exportBackupJson(): Promise<string | null> {
  if (!inTauri()) throw new Error(EXPORT_UNSUPPORTED_MESSAGE);
  const envelope = await collectBackup();
  const path = await saveTextFile(
    backupFilename("progress-backup"),
    serializeEnvelope(envelope),
  );
  if (path !== null) {
    useSettingsStore.getState().update({ lastBackupAt: Date.now() });
  }
  return path;
}
