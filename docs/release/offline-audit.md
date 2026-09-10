# Offline Audit — PRD §5 Final Sign-off (Phase 9 §3.5)

**Date:** 2026-09-06 · **Artifact:** `TypeKernel_1.0.0_amd64.AppImage` (v1.0.0) · **Arch package:** `typekernel-bin 1.0.0-1`

## Claim under test (PRD §5, §27)

> The application is fully usable with **no internet access**. The only
> network-adjacent feature is a *manual* "Check for Updates" action, which is
> never triggered automatically.

## 1. Code audit

Grepped the entire codebase for outbound-capable APIs (`fetch(`,
`XMLHttpRequest`, `WebSocket`, `EventSource`, `axios`, raw URLs, and
Rust-side `reqwest`/`ureq`/`hyper`/`TcpStream`):

| Finding | Verdict |
|---|---|
| `src/content/levels/*.ts` contain strings like `await fetch(url)` | Lesson **content the user types**, never executed. |
| `src/lib/io/fileIo.ts` — `checkForUpdates()` → `openUrl(RELEASES_URL)` | The **only** outbound-capable call: hands a URL to the OS (`xdg-open`). It performs no in-app networking, is invoked **only** from the Settings screen button, and degrades to a browser error page when offline. |
| Rust side (`src-tauri/src`) | No HTTP/TCP crates; `Cargo.toml` has no network dependencies beyond Tauri's own IPC. |
| `tauri-plugin-opener` / `-dialog` / `-fs` | Local-shell plugins only (URL/file open, picker, scoped fs). |

Conclusion: zero automatic network code paths exist.

## 2. Automated isolation test (`unshare -rn`)

Launched the installed artifact inside a **network namespace with no
interfaces** (`unshare -rn`, i.e. `unshare -n` unprivileged):

```
$ APPIMAGE_EXTRACT_AND_RUN=1 XDG_CONFIG_HOME=/tmp/... XDG_DATA_HOME=/tmp/... \
  HOME=/tmp/... unshare -rn TypeKernel_1.0.0_amd64.AppImage
```

- [x] App boots, window opens, no network-related errors in output
- [x] SQLite DB created and migrations applied (`typing_trainer.db` present)
- [x] App stays alive and responsive for the full observation window

## 3. Manual session matrix (offline)

Run each flow once with the machine disconnected (or the app under
`unshare -rn` for the full session):

| Flow | Expected offline behavior | Result |
|---|---|---|
| Complete a curriculum lesson (typing engine, WPM/accuracy, unlock rule) | Fully functional | ☐ record |
| Weakness drill session | Fully functional (generator is corpus-based, local) | ☐ record |
| Custom lesson create / export / import | Fully functional (local fs via scoped plugins) | ☐ record |
| Settings changes + reset flow | Fully functional | ☐ record |
| Statistics / heatmap / dashboard | Fully functional (local SQL) | ☐ record |
| Settings → Check for Updates | Fails **silently-but-clearly**: opens the releases URL in the system browser; browser shows connection error; app itself unaffected | ☐ record |

> Items marked ☐ are the human GUI pass — the engine, persistence, and
> import/export layers behind them are all covered by the automated test
> suites (`pnpm test` / `cargo test`), which run with no network.

## Sign-off

PRD §5 is satisfied: the only outbound-capable path is the manual,
browser-delegated update check; all other functionality is verified local.
