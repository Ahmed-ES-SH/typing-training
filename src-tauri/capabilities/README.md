# Capability / permission scope (Phase 7, §17 + §5)

The app is offline by design. This file documents the exact filesystem and
dialog permissions granted to the webview and *why* each exists — the goal is
that no blanket "read/write the whole disk" grant ever ships.

## Plugins registered (src-tauri/src/lib.rs)

| Plugin | Why |
|---|---|
| `tauri-plugin-dialog` | Native file **open** / **save** pickers for JSON import/export (§17). |
| `tauri-plugin-fs` | Reading / writing the picked JSON files and removing the SQLite database during the typed-confirmation **reset** flow (§20). |

## Permission scope

### Dialog — `dialog:default`

Grants the open/save/c/message dialogs. No filesystem access by itself.

**Scope extension at runtime:** when a user picks a path through the dialog
plugin, that exact path is added to the fs plugin's runtime scope for the
lifetime of the webview. This is the mechanism §3.5 requires: JSON
import/export can only ever touch files the user explicitly picked in the
native dialog — there is no static allow-list of arbitrary paths.

### fs — `fs:default`

Baseline read-only metadata access (exists/read stats on app dirs) needed to
detect the database file. It does **not** grant arbitrary read/write.

### fs — explicit scoped entries

| Permission | Scope | Why |
|---|---|---|
| `fs:allow-read-text-file` | `$APPCONFIG/typing_trainer.db*` | Verifying the DB file exists/readable around the reset flow. |
| `fs:allow-exists` | `$APPCONFIG/typing_trainer.db*` | Same — existence check for the DB + its WAL/SHM sidecars. |
| `fs:allow-remove` | `$APPCONFIG/typing_trainer.db`, `-wal`, `-shm` (exact files) | Reset flow §2/§20: WAL checkpoint → delete DB → re-migrate → re-seed. Only these three literal files are deletable. |

Imported/exported JSON files need **no static grant**: the write path is
`dialog.save()` → `fs.writeTextFile(pickedPath)` and the read path is
`dialog.open()` → `fs.readTextFile(pickedPath)`, both authorized by the
runtime scope extension described above. A user who never opens a picker has
granted the app access to exactly zero user files.

### What is deliberately NOT granted

- `fs:` scopes over `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `/`, `$TEMP` — none.
- `fs:allow-write-text-file` as a static grant (would allow writes anywhere
  the scope could later be extended without a picker).
- Shell/command plugins — the app never spawns processes (§5).
- Network — the opener plugin is used manually ("Check for Updates" opens the
  releases URL in the system browser); the app itself never phones home.
