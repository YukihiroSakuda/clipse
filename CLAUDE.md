# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend dev server only
npm run dev

# Full Tauri dev (frontend + Rust backend, hot-reload)
npm run tauri dev

# Production build
npm run tauri build

# Type-check frontend
npx tsc --noEmit

# Rust check (no compile)
cd src-tauri && cargo check

# Rust build only
cd src-tauri && cargo build
```

## UI Language Rules

- **No Japanese in structural UI text.** Button captions, labels, section titles, and `title` (tooltip) attributes are always English, regardless of the language setting below.
- **Icons first.** Prefer icons (lucide-react) over text labels. Add text only when an icon alone is ambiguous.
- When text is necessary, use short English labels (e.g. "Delete", "Cancel", "Copy path").
- **Exception — prose/explanatory text is translatable.** Longer hint/explanation paragraphs (rendered as `<p className={styles.hint}>` or similar) switch between English and Japanese based on `AppSettings.language` (`"en" | "ja"`, set in Settings → Language). Add new translatable strings to `src/lib/i18n.ts` and read them with `t(key, lang)`; short captions/labels never go through `t()`.
- **Exception — Settings window row labels are translatable.** The per-setting row labels in `Settings.tsx` (e.g. "Explanatory text", "Save folder", "Filename pattern") DO switch language via `t(key, lang)`. The window's section titles ("Language", "Saving", …), the "Settings" header, and the Save button stay English like everywhere else. The default language is Japanese (`AppSettings::default` in `settings.rs`).

## Architecture

**Clipse** is a Tauri v2 desktop app (React + Rust) for screenshot capture with annotation.

### Multi-window design

`App.tsx` routes to the correct view by reading the Tauri window label at runtime — no React Router:

| Window label | Route component | Purpose |

|---|---|---|
| `main` (default) | `Gallery` | Capture history list |
| `overlay-g{n}-{i}` | `Overlay` | Per-monitor transparent selection UI, pooled/prewarmed (`App.tsx`/`main.tsx` match on the `overlay` prefix) |
| `editor-{n}` | `Editor` | Annotation editor — **several can be open at once**, one per opened capture (`App.tsx`/`main.tsx` match on the `editor` prefix) |
| `settings` | `Settings` | App settings |
| `toast` | `Toast` | Capture-complete notification (bottom-right of captured monitor, click → editor) |
| `quickmenu` | `QuickMenu` | Ctrl+PrintScreen's action list at the cursor (arrow keys + Enter), pooled like the toast |

Windows are created dynamically from Rust (`src-tauri/src/window.rs`). Region selection uses **one transparent overlay window per monitor** (labels `overlay-g{generation}-{i}`), each positioned/sized to that monitor's exact physical bounds via `set_position(PhysicalPosition)` + `set_size(PhysicalSize)`. This is required on **mixed-DPI** multi-monitor setups: a single window spanning monitors can only render at one `devicePixelRatio`, so a different-DPI monitor's region gets stretched and its CSS↔physical coordinate mapping breaks (selection on that monitor becomes impossible). Each per-monitor window adopts its own monitor's scale factor, keeping rendering and coordinate math self-consistent.

**Overlay windows are pooled, not per-capture.** They are prewarmed hidden at startup (`window::prewarm_overlays`) and kept alive (hidden) between captures, so PrintScreen only has to *show* them — webview creation (hundreds of ms) is off the hot path. `open_overlay` shows the pool when the monitor-layout signature (`AppState.overlay_signature`) still matches, emitting `overlay-show`; the overlay frontend re-fetches window lists/scroll mode/origin and resets interaction state on that event. A signature mismatch rebuilds the pool under a bumped generation label (avoids label collision with the still-closing old windows). Esc calls the `cancel_overlay` IPC which **hides** (not closes) them all; `window::{hide_all_overlays, close_all_overlays}` operate on every `overlay`-prefixed window. The capability `windows` list uses the `overlay-*` glob. **Known limitation**: a free-region drag cannot cross monitor boundaries (each overlay is a separate OS window), and the backend region capture still clips to the single monitor containing the selection's top-left.

### Capture flow

1. User triggers capture via the `PrintScreen` hotkey or UI button
2. Rust hides the main window, shows the prewarmed overlays (or builds them on first run / monitor change)
3. After capture: `finish_capture_flow()` auto-saves → **always copies to the clipboard** → stores **raw PNG bytes** in `AppState.pending_image` (Mutex) → then either opens the editor directly (`open_editor_after_capture` setting, off by default) or shows the **capture-complete toast** (`window::show_capture_toast`) at the bottom-right of the captured monitor's work area. The toast never takes focus (`WS_EX_NOACTIVATE`), is excluded from screen capture, auto-dismisses after 5s (`toast_dismiss`), and opens the editor on click (`toast_open_editor`). Like the overlays it is created once and reused (hide → reposition → show + `toast-show` event). Opening the editor always creates a **new** `editor-{n}` window — never reuses an open one, so a capture taken while you're annotating can't replace the document you're working on (see "Multiple editors" below)
4. Editor fetches the image via the `get_pending_image` IPC — a **raw binary response** (`tauri::ipc::Response`, no base64), displayed through a blob object URL. The in-pipeline PNG encode uses fast compression (`dynamic_to_png_bytes` in `capture.rs`); a `[profile.dev.package.*]` override in `Cargo.toml` keeps the image crates optimized even in dev builds.

### Multiple editors

Every "open the editor" action (`window::open_editor` — toast click, `open_editor_after_capture`, gallery open) builds a **new** `editor-{n}` window; there is no reuse/reload path. That's what makes capturing while annotating safe, and lets several captures be worked on side by side. Consequences to keep in mind:

- **The pending document is per-window, not global.** `AppState.pending_{image,path,annotations}` are only a *staging slot* for the next editor to be opened. `open_editor` copies them into `AppState.pending_editors[label]` (a `PendingCapture`) **before** the window is built, and `get_pending_image`/`get_pending_path`/`get_pending_annotations` resolve by the **calling window's own label** (`tauri::WebviewWindow` command argument). Without this, a capture completing while a just-opened editor was still cold-starting would swap that editor's document out from under it. The entry is dropped on the window's `Destroyed` event, same lifecycle as `pinned_images`.
- **Editors are currently *not* excluded from screen capture** (`window::EXCLUDE_EDITORS_FROM_CAPTURE = false`), so a capture taken while an editor is on screen includes it. The machinery to exclude them per capture session is in place behind that const — see the exclusion section below.
- **Copy/paste of annotations goes through the backend.** Each editor window is its own webview with its own Zustand store, so the clipboard payload lives in `AppState.annotation_clipboard` (`set_annotation_clipboard` / `get_annotation_clipboard`) — deliberately *not* the OS clipboard, which would clobber the user's own clipboard content and paste as JSON gibberish into other apps. It carries a `seq` bumped on every copy; a pasting window compares it against its own `clipboardSeq` to know when to restart the cascading paste offset. `nudgeIntoView` (store.ts) pulls a pasted group back onto the canvas when it came from a much larger capture and would otherwise land entirely off-image.
- Two editors opened on the **same** file both save to it (last write wins) — opening from the gallery is not deduplicated.

### Frontend–Backend IPC

All Tauri commands are wrapped in `src/lib/ipc.ts` as typed async functions using `invoke()`. Never call `invoke()` directly from components — go through `ipc.*`.

Two layers of capture commands exist:
- **High-level** (`open_region_overlay`, `do_window_capture`, `do_fullscreen_capture`, `do_repeat_region_capture`, `do_virtual_desktop_capture`): include auto-save + editor open side effects. `do_repeat_region_capture` re-captures the rect stored in `AppState.last_region` by the last `complete_region_capture`; `do_virtual_desktop_capture` composites every monitor into one image.
- **Low-level** (`capture_fullscreen`, `capture_active_window`, `capture_region`): return raw base64 PNG, no side effects

### State management

`src/lib/store.ts` — one Zustand store instance **per editor window** (each window is a separate webview, so nothing in it is shared between editors — see "Multiple editors"):
- `capturedImage` — the image being edited
- `annotations` + `annotationHistory` — undo stack (array of snapshots)
- `nextNumber` — auto-incrementing counter for numbered markers
- `captures` — gallery entries list

### Annotation system

All annotation types are defined in `src/lib/annotations.ts`. Coordinates are always in **image-pixel space** (not canvas/screen space). `drawAnnotation()` is the single renderer for all annotation types; it expects the canvas context pre-transformed to image coordinates.

### Rust backend structure

```
src-tauri/src/
  lib.rs           — Tauri setup, plugin registration, hotkey handler, invoke_handler
  state.rs         — AppState: capture staging slots (pending_image/path/annotations),
                     per-window docs (pending_editors), annotation_clipboard, settings,
                     overlay pool signature, frozen frame, capturing flag
  window.rs        — Window creation helpers (overlay pool, editors, toast, pins…)
  capture_win.rs   — Windows-only (#[cfg]) DXGI Desktop Duplication; physical-pixel capture
  commands/
    capture.rs     — screen capture orchestration; all xcap types (non-Send) used inside sync closures before any .await
    clipboard.rs   — clipboard write via tauri-plugin-clipboard-manager
    storage.rs     — saves/lists PNG files in app data dir
    ocr.rs         — OCR extraction
```

**Two-tier capture strategy**: Every capture path in `capture.rs` (region, window, fullscreen) first attempts `capture_win::capture_region_physical()` — DXGI Desktop Duplication, which captures at **native physical-pixel resolution** and bypasses GDI DPI scaling. On any error (locked screen, no GPU, all-black frame, non-Windows) it falls back to **xcap/GDI**, which captures at logical/DPI-scaled resolution. DXGI enumerates all adapters via `IDXGIFactory1` to find the one owning the target monitor — picking the wrong adapter (e.g. discrete GPU on a laptop driving an iGPU display) yields permanently black frames. Each cached duplication also keeps a **GPU-side copy of the last good frame**: `AcquireNextFrame` only delivers on screen *change*, so on a static desktop the crop is served from that copy instead of timing out. An all-black DXGI frame is **cross-checked via GDI `GetPixel` samples** — if GDI agrees the region really is black it's returned as valid content; only disagreements count toward the 3-strike session disable. Non-BGRA frame formats (HDR FP16) are refused up front (`read_crop`) so they fall back to GDI instead of decoding as garbage.

**Critical constraint**: `xcap::Monitor` and `xcap::Window` are `!Send`. All xcap calls must complete inside a synchronous closure that is dropped before any `.await` point. This pattern is used consistently in `capture.rs`.

**Display-topology changes (VDI/RDP, monitor hot-plug)**: a hidden top-level window on the hook thread (`hook_win.rs`) receives `WM_DISPLAYCHANGE` and, debounced ~1s, (a) drops the whole DXGI duplication cache and re-arms the all-black kill switch (`capture_win::invalidate_after_display_change`) and (b) force-rebuilds the overlay pool even when the layout signature is unchanged (`window::rebuild_overlays_for_display_change` — a pooled hidden WebView2 can come back blank after being shuffled across monitors while a display was detached, with `show()` still succeeding). The overlay fast path also treats any pooled window's set_position/set_size/show failure as pool corruption and falls through to a full rebuild. Key decisions (hotkey dispatch, overlay open + monitor enumeration, pool path taken, capture-claim rejection/takeover, DXGI disable/invalidate) are logged via `diag.rs` to `clipse.log` (size-rotated) in the app data dir — geometry and code paths only, so field reports from corporate machines can include it. A "PrintScreen does nothing" report is triaged by which of the three stage lines is missing: `hook: PrintScreen dispatched` (the key never reached the hook), `overlay: opening` (the claim was refused — the next line says so), `overlay: N monitor(s) enumerated` (the desktop freeze or enumeration stalled).

**PrintScreen-to-overlay latency is a feature, and it is measured.** The whole overlay-pool/prewarm design exists to keep this path at "instant"; anything that adds hundreds of ms to it makes the hotkey read as broken rather than slow. Costs on that path, in order:

- **DWM settle** — `HIDE_SETTLE_MS` (150ms, a window was hidden and DWM must finish tearing it down) or `AFFINITY_SETTLE_MS` (80ms, only a display-affinity change has to reach the next composition), whichever applies. With `EXCLUDE_EDITORS_FROM_CAPTURE` off, an open editor costs nothing here.
- **Desktop freeze** (`capture_composited_settled`) — re-shoots until two consecutive grabs match, bounded by **wall clock** (`FREEZE_SETTLE_BUDGET_MS`), not just a reshoot count. A count-only budget silently cost 2.5s on a 1080p dev build: a desktop with a terminal printing or a caret blinking never settles, so every reshoot was spent.
- **Compositing** (`capture_rect_composited`) — has a single-monitor fast path. Without it, a rect inside one monitor still allocated and zeroed a second full-size buffer and copied every pixel into it, which on a single-monitor desktop is the function's entire cost for no benefit.
- **The overlay frontend** — the dim layer is painted as soon as `init()`'s metadata fetches resolve, *before* the frozen background arrives, so perceived latency is `overlay: dim drawn` and not `overlay: painted`. Both are logged.

`[profile.dev.package.clipse] opt-level = 2` exists for the same reason as the dependency overrides next to it: the DXGI per-row pixel copy is in *this* crate, and unoptimized it made one 1080p grab take ~400-800ms — fast in release, "the hotkey is broken" in dev.

Every stage above writes a line to `clipse.log`, so a latency regression is measurable from a field report instead of guessed at.

**Never call a Tauri window method on the capture hot path to *read* something.** Getters like `is_visible()`, `outer_position()`, `scale_factor()` and `window_handle()` are blocking round-trips to the main-thread event loop with no timeout (`window_getter!` in tauri-runtime-wry). The capture paths run on an async-runtime thread, so each one couples the capture to the main thread being free. Where such a value is needed later, resolve it once at window-setup time and cache it: `AppState.editor_hwnds` holds each editor's raw `HWND` precisely so `window::set_editors_excluded_from_capture` can call `SetWindowDisplayAffinity` (which has no thread affinity) without asking Tauri anything, and `AppState.overlay_showing` is an atomic so `try_claim_capture` can tell a live session from a leaked claim without querying a window.

**The capture claim self-heals.** `AppState.capturing` is only released by the pipeline that took it, so a pipeline that dies without releasing used to wedge every later capture for the rest of the session with no symptom beyond "PrintScreen stopped working". `try_claim_capture` now records `capture_claimed_at` and, on a claim held past `STALE_CLAIM_SECS` with no overlay showing and no scrolling capture running, takes it over (logged). Long-running window creation is also kept out of the claim: `finish_capture_flow` spawns `open_editor` instead of awaiting it.

### Global hotkeys

| Default shortcut | Action | Mechanism |
|---|---|---|
| `PrintScreen` | Region select overlay (Screenpresso-style) | Low-level keyboard hook (`hook_win.rs`) |
| `Ctrl+PrintScreen` | Quick action menu at the cursor (`quickmenu` window) | Low-level keyboard hook (`hook_win.rs`) |

**There are exactly two global shortcuts, and the second one is a menu.** Everything else Clipse can do — repeat last region, all monitors, scrolling capture, fixed-size, record, gallery, settings, capture-this-monitor — is reached from the quick menu rather than from a hotkey of its own. That is the whole design: one key to capture, one key to reach everything else, instead of a hotkey table the user has to memorize.

**Both are rebindable (Settings → Global shortcuts); the table above is only the default.** The accelerator lives in `AppSettings.shortcuts` as `Ctrl+Alt+Shift+Key` text, parsed by [`shortcuts.rs`](src-tauri/src/shortcuts.rs) — whose `NAMED_KEYS` and canonical ordering `src/lib/shortcuts.ts` mirrors exactly, since that string is what crosses IPC and lands in `settings.json`. In-app shortcuts (the editor's tools and actions, the gallery's) are **not** configurable; only these two are.

- **The hook reads its bindings from four atomics, not a lock.** `keyboard_proc` runs for every keystroke on the machine, and a lock held by a settings save while the user types would stall it — Windows silently evicts a hook that overruns `LowLevelHooksTimeout`, after which every hotkey stops working with no error anywhere. Two `u32`s per binding fit in atomics exactly, so the question doesn't arise.
- **Validation is a safety rail, not politeness.** A matched binding is swallowed process-wide, so a bare `A` would take that key away from every application. `Accel::validate` requires at least one modifier unless the key is one nothing types with (PrintScreen, Pause, ScrollLock, F13–F24), rejects `Alt+PrintScreen` (the OS owns it), and `shortcuts::resolve` falls back to the shipped default for anything unparseable — a hand-mangled `settings.json` degrades rather than leaving an action unreachable. Binding both actions to one key is refused in the UI and repaired in `apply_shortcuts`, since the hook matches in order and capture would always win.
- **Recording a new binding suspends the hook** (`set_shortcut_recording` → `hook_win::suspend`), which also unregisters the fallback hotkeys. Without it the recorder could never capture the very keys it most needs to: a bound keystroke is swallowed before any webview sees it, making PrintScreen — the default — impossible to re-enter. The frontend resumes in a `finally` and on unmount.
- **The recorder listens on keydown *and* keyup**, because Chromium only ever reports PrintScreen on keyup.

**The action list has one implementation, in `commands/actions.rs`.** The tray menu and the quick menu are two presentations of the same `QuickAction` enum, and they share the string ids (`"cap_repeat"`, `"cap_all"`, …) — tray `MenuItem` ids, the `quick_menu_run` IPC argument, and `QuickMenu.tsx`'s `ITEMS` are all keyed on them. Adding an action means one arm in `QuickAction::run` plus a row in whichever surfaces should show it. `tray.rs` keeps only what has no quick-menu counterpart (About, Quit) and its own `dismiss_tray_menu()` settle, which exists for the tray flyout and nothing else.

**PrintScreen has three paths, because the first two both fail while a Clipse window is focused.** The low-level hook is observed to receive *nothing* — no key at all, not just PrintScreen — whenever one of our own WebView2 windows (editor, gallery) holds focus. A `WH_KEYBOARD_LL` hook is not supposed to be focus-dependent and **the mechanism is still unexplained**; what is established from `clipse.log` is that in that state the hook is silent while `RegisterHotKey` still delivers. So: the hook is primary, the hotkey below is second, and `usePrintScreenKey` (`src/lib/usePrintScreenKey.ts`, used by `Editor` and `Gallery`) is the third — the focused window handling its own keystroke. Nothing double-fires: a hook that receives the key swallows it, so it never reaches a webview. Chromium delivers PrintScreen on **keyup only**, hence that hook listens on keyup. Each path names itself in `clipse.log` (`hook:` / `hotkey:` / `editor:`/`gallery:`), so which one fired is always recoverable from a field report.

**Each shortcut has a second, fallback path.** `RegisterHotKey` is *also* used for both bindings (`register_fallback`, re-made from the atomics whenever they change), for the case where the low-level hook never receives the keystroke at all. The two can't double-fire: the hook runs ahead of hotkey dispatch and swallows PrintScreen (`LRESULT(1)`), so a working hook means `WM_HOTKEY` is never delivered — the fallback only fires when the hook missed it. Registration is best-effort (it fails when another process owns the key, which is exactly why the hook is the primary path); failure is logged and costs nothing. `clipse.log` names the path that fired: `hook: PrintScreen dispatched` vs `hotkey: PrintScreen dispatched`.

**PrintScreen is special.** `RegisterHotKey`-based global shortcuts lose the race for PrintScreen whenever another process holds it — Screenpresso, or Windows 11's own Snipping Tool ("Use PrtScn to open screen snipping"), which fails registration with `HotKey already registered`. So PrintScreen is instead grabbed via a **Windows `WH_KEYBOARD_LL` low-level keyboard hook** ([hook_win.rs](src-tauri/src/hook_win.rs), Windows-only, installed from `lib.rs` setup). The hook runs ahead of hotkey dispatch, fires on key-up, and **swallows** the keystroke (`return LRESULT(1)`) so the default Snipping Tool is suppressed. **Anything held with the Win key passes through untouched** (`CallNextHookEx`, checked before the binding match so no rebinding can shadow it), and `Alt+PrintScreen` can't be bound at all — those are OS muscle-memory shortcuts (save-to-file / active-window-to-clipboard). Only an *exact* modifier match is claimed, so every other combination reaches the app underneath. The hook lives on a dedicated thread with its own `GetMessageW` pump (required for LL-hook delivery); the AppHandle reaches the C callback via a `OnceLock` static.

**Ctrl+PrintScreen opens the quick menu** (`window::open_quick_menu`, dispatched from the hook via `GetAsyncKeyState(VK_CONTROL)` at key-up). Like the overlay pool it is **prewarmed hidden at startup** (`window::prewarm_quick_menu`) and then reused (hide → reposition → show + a `quickmenu-show` event that resets the selection to the first row) — a menu on a global hotkey has to feel instant, and building a WebView2 costs hundreds of ms. It is positioned at the cursor context-menu style (down-right, flipping when the work area has no room, then clamped), sized by `QUICKMENU_W`/`QUICKMENU_H` which must stay in step with `QuickMenu.module.css`. Unlike every other floating window here **it takes focus**, because it is driven with the arrow keys and Enter; losing focus dismisses it, as an OS menu would.

**`do_cursor_monitor_capture` is now a menu item, and it lost the property it was built for.** It used to *be* Ctrl+PrintScreen, specifically so a capture could include transient desktop UI: showing/focusing the region overlay activates a window, which dismisses an open right-click context menu, whereas capturing the monitor under the cursor straight from `xcap`/DXGI activates nothing. Reaching it through the quick menu defeats that — the menu takes focus to read the arrow keys, so any context menu is gone before the action runs. The command is unchanged and still reachable (`QuickAction::CursorMonitor`, "Capture This Monitor"); only the "menus survive into the capture" guarantee is gone. Restoring it would mean giving it back a hotkey that activates nothing.

### Tray residency

The app runs resident in the system tray (`tray.rs`, built in `lib.rs` setup, requires the `tray-icon` Cargo feature). The `main` window starts with `"visible": false` (tray-only launch) and its `CloseRequested` event is intercepted to **hide instead of quit** — the app only exits via the tray menu's Quit. Left-clicking the tray shows the gallery; the tray menu also exposes the three capture actions and Settings.

### Excluding Clipse's own windows from capture

Any Clipse window that can be on screen *while a capture happens* must never end up in that capture's pixels. The robust mechanism is `window::set_excluded_from_capture` (`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`, Windows-only): it excludes a window from every capture path (DXGI Desktop Duplication, GDI, Windows.Graphics.Capture) at the OS/compositor level, regardless of the window's actual visibility or any hide()/show() timing race. Used by:
- The **`main` gallery window** — set once at startup (`lib.rs` setup, right after `disable_browser_accelerator_keys`). Before this, the gallery relied solely on being `hide()`-called with a settle delay before `freeze_desktop()`'s snapshot; a WebView2 window (GPU-composited) isn't always fully dropped from the composited desktop by the time a fixed sleep elapses, so a residual frame of the gallery could get baked into the frozen snapshot and "ghost" in the overlay's background for the whole selection drag, or even into the final captured image. Exclusion removes the race entirely.
- Every **`editor-{n}` window** — **currently not excluded at all**: `window::EXCLUDE_EDITORS_FROM_CAPTURE` is `false`, so an editor on screen when a capture starts is part of the desktop like any other window (it appears in the frozen snapshot, hence in the overlay background and in the capture). Flipping that const to `true` restores the behavior described in the rest of this bullet; the HWND caching it needs is in place either way. When on, an editor is excluded only **while a capture session is in flight**, not permanently like the gallery. Permanent exclusion would also hide the editor from Teams/Zoom screen shares and third-party recorders, and "annotate a screenshot, then show it to someone" is a normal use of that window. Every path that captures the *desktop* calls `window::exclude_visible_editors_from_capture` first (`open_overlay_inner` before `freeze_desktop`; `do_fullscreen_capture` / `do_virtual_desktop_capture` / `do_repeat_region_capture` before their settle sleep), and `release_capture` restores them on every exit — success, cancel, or error. Two paths deliberately opt out: `do_cursor_monitor_capture` (the quick menu's "Capture This Monitor"), whose whole purpose is capturing exactly what is on screen at that instant, and `do_window_capture`, which may well be pointed at an editor. Editors are also deliberately *not* hidden during a capture (the overlay covers them, and a hide/show cycle would disturb work in progress) — but because the affinity change only reaches captured output on DWM's next composition, a visible editor makes those paths take their 150ms settle even when they'd otherwise skip it.
- The **Fixed Capture control window** (`open_fixed_capture` in `window.rs`) — excluded permanently at creation.
- The **quick menu** (`open_quick_menu`) — excluded permanently at creation, for the same reason: every action on it can start a capture, so no hide/show timing may decide whether the menu ends up in one. It is *also* hidden by `open_overlay_inner` (so a stale menu isn't left sitting under the overlay), but deliberately **without** a settle wait — the exclusion already makes its pixels unreachable, and paying `HIDE_SETTLE_MS` there would slow the "menu open, user hits PrintScreen instead" path for nothing.
- The **capture-complete toast** (`window::show_capture_toast`) and the **scroll-progress indicator** (`window::show_scroll_progress`) — both permanently excluded, click-through, and never take focus.
- The **recorder's mini control bar** (`commands/record.rs`) — toggled dynamically with the `recording` flag, so it stays out of its own screen recording specifically.

Note the distinction: `hide()`/`show()` still control what the *user* sees on their own desktop; `set_excluded_from_capture` only controls what ends up in a *capture's output*. A window that must be invisible to the user (overlays, during their own hide) still needs the hide+settle-delay pattern (see `open_overlay_inner`'s 150ms wait after hiding `main`/`fixed-capture`, before `freeze_desktop()`) — exclusion doesn't substitute for that, it only guarantees the window's pixels can never appear in a capture no matter how that timing plays out.

### Tauri capabilities

Permissions are declared in `src-tauri/capabilities/default.json`. When adding a new Tauri plugin, add its permission there.
cl
