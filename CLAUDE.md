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
| `editor` | `Editor` | Annotation editor |
| `settings` | `Settings` | App settings |
| `toast` | `Toast` | Capture-complete notification (bottom-right of captured monitor, click → editor) |

Windows are created dynamically from Rust (`src-tauri/src/window.rs`). Region selection uses **one transparent overlay window per monitor** (labels `overlay-g{generation}-{i}`), each positioned/sized to that monitor's exact physical bounds via `set_position(PhysicalPosition)` + `set_size(PhysicalSize)`. This is required on **mixed-DPI** multi-monitor setups: a single window spanning monitors can only render at one `devicePixelRatio`, so a different-DPI monitor's region gets stretched and its CSS↔physical coordinate mapping breaks (selection on that monitor becomes impossible). Each per-monitor window adopts its own monitor's scale factor, keeping rendering and coordinate math self-consistent.

**Overlay windows are pooled, not per-capture.** They are prewarmed hidden at startup (`window::prewarm_overlays`) and kept alive (hidden) between captures, so PrintScreen only has to *show* them — webview creation (hundreds of ms) is off the hot path. `open_overlay` shows the pool when the monitor-layout signature (`AppState.overlay_signature`) still matches, emitting `overlay-show`; the overlay frontend re-fetches window lists/scroll mode/origin and resets interaction state on that event. A signature mismatch rebuilds the pool under a bumped generation label (avoids label collision with the still-closing old windows). Esc calls the `cancel_overlay` IPC which **hides** (not closes) them all; `window::{hide_all_overlays, close_all_overlays}` operate on every `overlay`-prefixed window. The capability `windows` list uses the `overlay-*` glob. **Known limitation**: a free-region drag cannot cross monitor boundaries (each overlay is a separate OS window), and the backend region capture still clips to the single monitor containing the selection's top-left.

### Capture flow

1. User triggers capture via the `PrintScreen` hotkey or UI button
2. Rust hides the main window, shows the prewarmed overlays (or builds them on first run / monitor change)
3. After capture: `finish_capture_flow()` auto-saves → **always copies to the clipboard** → stores **raw PNG bytes** in `AppState.pending_image` (Mutex) → then either opens the editor directly (`open_editor_after_capture` setting, off by default) or shows the **capture-complete toast** (`window::show_capture_toast`) at the bottom-right of the captured monitor's work area. The toast never takes focus (`WS_EX_NOACTIVATE`), is excluded from screen capture, auto-dismisses after 5s (`toast_dismiss`), and opens the editor on click (`toast_open_editor`). Like the overlays it is created once and reused (hide → reposition → show + `toast-show` event). When the editor opens, an already-open editor is **reused** via the `editor-load` event instead of close+recreate
4. Editor fetches the image via the `get_pending_image` IPC — a **raw binary response** (`tauri::ipc::Response`, no base64), displayed through a blob object URL. The in-pipeline PNG encode uses fast compression (`dynamic_to_png_bytes` in `capture.rs`); a `[profile.dev.package.*]` override in `Cargo.toml` keeps the image crates optimized even in dev builds.

### Frontend–Backend IPC

All Tauri commands are wrapped in `src/lib/ipc.ts` as typed async functions using `invoke()`. Never call `invoke()` directly from components — go through `ipc.*`.

Two layers of capture commands exist:
- **High-level** (`open_region_overlay`, `do_window_capture`, `do_fullscreen_capture`, `do_repeat_region_capture`, `do_virtual_desktop_capture`): include auto-save + editor open side effects. `do_repeat_region_capture` re-captures the rect stored in `AppState.last_region` by the last `complete_region_capture`; `do_virtual_desktop_capture` composites every monitor into one image.
- **Low-level** (`capture_fullscreen`, `capture_active_window`, `capture_region`): return raw base64 PNG, no side effects

### State management

`src/lib/store.ts` — single Zustand store for the editor window:
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
  state.rs         — AppState { pending_image: Mutex<Option<String>> }
  window.rs        — Window creation helpers (overlay, editor)
  capture_win.rs   — Windows-only (#[cfg]) DXGI Desktop Duplication; physical-pixel capture
  commands/
    capture.rs     — screen capture orchestration; all xcap types (non-Send) used inside sync closures before any .await
    clipboard.rs   — clipboard write via tauri-plugin-clipboard-manager
    storage.rs     — saves/lists PNG files in app data dir
    ocr.rs         — OCR extraction
```

**Two-tier capture strategy**: Every capture path in `capture.rs` (region, window, fullscreen) first attempts `capture_win::capture_region_physical()` — DXGI Desktop Duplication, which captures at **native physical-pixel resolution** and bypasses GDI DPI scaling. On any error (locked screen, no GPU, all-black frame, non-Windows) it falls back to **xcap/GDI**, which captures at logical/DPI-scaled resolution. DXGI enumerates all adapters via `IDXGIFactory1` to find the one owning the target monitor — picking the wrong adapter (e.g. discrete GPU on a laptop driving an iGPU display) yields permanently black frames. Each cached duplication also keeps a **GPU-side copy of the last good frame**: `AcquireNextFrame` only delivers on screen *change*, so on a static desktop the crop is served from that copy instead of timing out. An all-black DXGI frame is **cross-checked via GDI `GetPixel` samples** — if GDI agrees the region really is black it's returned as valid content; only disagreements count toward the 3-strike session disable. Non-BGRA frame formats (HDR FP16) are refused up front (`read_crop`) so they fall back to GDI instead of decoding as garbage.

**Critical constraint**: `xcap::Monitor` and `xcap::Window` are `!Send`. All xcap calls must complete inside a synchronous closure that is dropped before any `.await` point. This pattern is used consistently in `capture.rs`.

**Display-topology changes (VDI/RDP, monitor hot-plug)**: a hidden top-level window on the hook thread (`hook_win.rs`) receives `WM_DISPLAYCHANGE` and, debounced ~1s, (a) drops the whole DXGI duplication cache and re-arms the all-black kill switch (`capture_win::invalidate_after_display_change`) and (b) force-rebuilds the overlay pool even when the layout signature is unchanged (`window::rebuild_overlays_for_display_change` — a pooled hidden WebView2 can come back blank after being shuffled across monitors while a display was detached, with `show()` still succeeding). The overlay fast path also treats any pooled window's set_position/set_size/show failure as pool corruption and falls through to a full rebuild. Key decisions (monitor enumeration at capture time, pool path taken, DXGI disable/invalidate) are logged via `diag.rs` to `clipse.log` (size-rotated) in the app data dir — geometry and code paths only, so field reports from corporate machines can include it.

### Global hotkeys

| Shortcut | Action | Mechanism |
|---|---|---|
| `PrintScreen` | Region select overlay (Screenpresso-style) | Low-level keyboard hook (`hook_win.rs`) |
| `Ctrl+PrintScreen` | Instant capture of the monitor under the cursor, no overlay | Low-level keyboard hook (`hook_win.rs`) |

**PrintScreen is special.** `RegisterHotKey`-based global shortcuts lose the race for PrintScreen whenever another process holds it — Screenpresso, or Windows 11's own Snipping Tool ("Use PrtScn to open screen snipping"), which fails registration with `HotKey already registered`. So PrintScreen is instead grabbed via a **Windows `WH_KEYBOARD_LL` low-level keyboard hook** ([hook_win.rs](src-tauri/src/hook_win.rs), Windows-only, installed from `lib.rs` setup). The hook runs ahead of hotkey dispatch, fires the region overlay on key-up, and **swallows** the keystroke (`return LRESULT(1)`) so the default Snipping Tool is suppressed. **Alt+PrtScn / Win+PrtScn are passed through untouched** (`CallNextHookEx`) — those are OS muscle-memory shortcuts (active-window-to-clipboard / save-to-file); only plain and Ctrl+PrintScreen are claimed. The hook lives on a dedicated thread with its own `GetMessageW` pump (required for LL-hook delivery); the AppHandle reaches the C callback via a `OnceLock` static.

**Ctrl+PrintScreen exists to preserve transient desktop UI.** Showing/focusing the region-select overlay activates a window, which is exactly what dismisses an open right-click context menu — so the normal PrintScreen flow can never include one. Ctrl+PrintScreen instead calls `commands::capture::do_cursor_monitor_capture` directly from the hook (checked via `GetAsyncKeyState(VK_CONTROL)` at key-up), which captures the monitor under the mouse straight from `xcap`/DXGI with no overlay and no window activation in between — so anything on screen at that instant, menus included, survives into the capture.

### Tray residency

The app runs resident in the system tray (`tray.rs`, built in `lib.rs` setup, requires the `tray-icon` Cargo feature). The `main` window starts with `"visible": false` (tray-only launch) and its `CloseRequested` event is intercepted to **hide instead of quit** — the app only exits via the tray menu's Quit. Left-clicking the tray shows the gallery; the tray menu also exposes the three capture actions and Settings.

### Excluding Clipse's own windows from capture

Any Clipse window that can be on screen *while a capture happens* must never end up in that capture's pixels. The robust mechanism is `window::set_excluded_from_capture` (`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`, Windows-only): it excludes a window from every capture path (DXGI Desktop Duplication, GDI, Windows.Graphics.Capture) at the OS/compositor level, regardless of the window's actual visibility or any hide()/show() timing race. Used by:
- The **`main` gallery window** — set once at startup (`lib.rs` setup, right after `disable_browser_accelerator_keys`). Before this, the gallery relied solely on being `hide()`-called with a settle delay before `freeze_desktop()`'s snapshot; a WebView2 window (GPU-composited) isn't always fully dropped from the composited desktop by the time a fixed sleep elapses, so a residual frame of the gallery could get baked into the frozen snapshot and "ghost" in the overlay's background for the whole selection drag, or even into the final captured image. Exclusion removes the race entirely.
- The **Fixed Capture control window** (`open_fixed_capture` in `window.rs`) — excluded permanently at creation.
- The **capture-complete toast** (`window::show_capture_toast`) and the **scroll-progress indicator** (`window::show_scroll_progress`) — both permanently excluded, click-through, and never take focus.
- The **recorder's mini control bar** (`commands/record.rs`) — toggled dynamically with the `recording` flag, so it stays out of its own screen recording specifically.

Note the distinction: `hide()`/`show()` still control what the *user* sees on their own desktop; `set_excluded_from_capture` only controls what ends up in a *capture's output*. A window that must be invisible to the user (overlays, during their own hide) still needs the hide+settle-delay pattern (see `open_overlay_inner`'s 150ms wait after hiding `main`/`fixed-capture`, before `freeze_desktop()`) — exclusion doesn't substitute for that, it only guarantees the window's pixels can never appear in a capture no matter how that timing plays out.

### Tauri capabilities

Permissions are declared in `src-tauri/capabilities/default.json`. When adding a new Tauri plugin, add its permission there.
cl
