import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../db/testing";
import { DEFAULT_SETTINGS, useSettingsStore } from "../../stores/useSettingsStore";
import { exportBackupJson, EXPORT_UNSUPPORTED_MESSAGE } from "./backupExport";
import { inTauri, saveTextFile } from "./fileIo";

/**
 * §5.2.4 export flow: the fs/dialog layer is mocked (node env — no Tauri),
 * while `collectBackup` runs against the in-memory harness DB.
 */

vi.mock("./fileIo", () => ({
  inTauri: vi.fn(() => true),
  saveTextFile: vi.fn(),
}));

beforeEach(() => {
  connectTestDb();
  // Never-hydrated state: `update` stamps in memory only, so no debounced
  // write can race the assertions below.
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
  vi.mocked(saveTextFile).mockReset();
  vi.mocked(inTauri).mockReturnValue(true);
});

describe("exportBackupJson", () => {
  it("stamps lastBackupAt when the save dialog returns a path", async () => {
    vi.mocked(saveTextFile).mockResolvedValue("/tmp/typekernel-backup.json");

    const path = await exportBackupJson();

    expect(path).toBe("/tmp/typekernel-backup.json");
    expect(saveTextFile).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings.lastBackupAt).toBeTypeOf("number");
  });

  it("leaves lastBackupAt null when the save dialog is cancelled", async () => {
    vi.mocked(saveTextFile).mockResolvedValue(null);

    const path = await exportBackupJson();

    expect(path).toBeNull();
    expect(useSettingsStore.getState().settings.lastBackupAt).toBeNull();
  });

  it("rejects outside the Tauri shell instead of silently no-oping", async () => {
    vi.mocked(inTauri).mockReturnValue(false);

    await expect(exportBackupJson()).rejects.toThrow(EXPORT_UNSUPPORTED_MESSAGE);
    expect(saveTextFile).not.toHaveBeenCalled();
  });
});
