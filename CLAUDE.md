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

- **No Japanese anywhere in the UI.** All visible text must be English.
- **Icons first.** Prefer icons (lucide-react) over text labels. Add text only when an icon alone is ambiguous.
- When text is necessary, use short English labels (e.g. "Delete", "Cancel", "Copy path").
- `title` attributes (tooltips) are also English.

## Architecture

**Clipse** is a Tauri v2 desktop app (React + Rust) for screenshot capture with annotation.

### Multi-window design

`App.tsx` routes to the correct view by reading the Tauri window label at runtime — no React Router:

| Window label | Route component | Purpose |
|---|---|---|
| `main` (default) | `Gallery` | Capture history list |
| `overlay-{i}` | `Overlay` | Per-monitor transparent selection UI (`App.tsx`/`main.tsx` match on the `overlay` prefix) |
| `editor` | `Editor` | Annotation editor |
| `settings` | `Settings` | App settings |

Windows are created dynamically from Rust (`src-tauri/src/window.rs`). Region selection creates **one transparent overlay window per monitor** (`overlay-0`, `overlay-1`, …), each positioned/sized to that monitor's exact physical bounds via `set_position(PhysicalPosition)` + `set_size(PhysicalSize)`. This is required on **mixed-DPI** multi-monitor setups: a single window spanning monitors can only render at one `devicePixelRatio`, so a different-DPI monitor's region gets stretched and its CSS↔physical coordinate mapping breaks (selection on that monitor becomes impossible). Each per-monitor window adopts its own monitor's scale factor, keeping rendering and coordinate math self-consistent. `window::{hide_all_overlays, close_all_overlays}` operate on every `overlay`-prefixed window; Esc on any overlay calls the `cancel_overlay` IPC to close them all (only the focused overlay receives the keystroke). The capability `windows` list uses the `overlay-*` glob. **Known limitation**: a free-region drag cannot cross monitor boundaries (each overlay is a separate OS window), and the backend region capture still clips to the single monitor containing the selection's top-left.

### Capture flow

1. User triggers capture via hotkey (`Ctrl+Shift+1/2/3`) or UI button
2. Rust hides the main window, creates the appropriate window/overlay
3. After capture: `finish_capture_flow()` auto-saves → stores base64 PNG in `AppState.pending_image` (Mutex) → opens editor window
4. Editor calls `get_pending_image` IPC on mount to retrieve the image

### Frontend–Backend IPC

All Tauri commands are wrapped in `src/lib/ipc.ts` as typed async functions using `invoke()`. Never call `invoke()` directly from components — go through `ipc.*`.

Two layers of capture commands exist:
- **High-level** (`open_region_overlay`, `do_window_capture`, `do_fullscreen_capture`): include auto-save + editor open side effects
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

**Two-tier capture strategy**: Every capture path in `capture.rs` (region, window, fullscreen) first attempts `capture_win::capture_region_physical()` — DXGI Desktop Duplication, which captures at **native physical-pixel resolution** and bypasses GDI DPI scaling. On any error (locked screen, no GPU, all-black frame, non-Windows) it falls back to **xcap/GDI**, which captures at logical/DPI-scaled resolution. DXGI enumerates all adapters via `IDXGIFactory1` to find the one owning the target monitor — picking the wrong adapter (e.g. discrete GPU on a laptop driving an iGPU display) yields permanently black frames.

**Critical constraint**: `xcap::Monitor` and `xcap::Window` are `!Send`. All xcap calls must complete inside a synchronous closure that is dropped before any `.await` point. This pattern is used consistently in `capture.rs`.

### Global hotkeys

| Shortcut | Action | Mechanism |
|---|---|---|
| `PrintScreen` | Region select overlay (Screenpresso-style) | Low-level keyboard hook (`hook_win.rs`) |
| `Ctrl+Shift+1` | Region select overlay | `tauri_plugin_global_shortcut` |
| `Ctrl+Shift+2` | Active window capture | `tauri_plugin_global_shortcut` |
| `Ctrl+Shift+3` | Fullscreen capture (primary monitor) | `tauri_plugin_global_shortcut` |

The `Ctrl+Shift+N` shortcuts are registered in `lib.rs` setup and dispatched through the global-shortcut handler.

**PrintScreen is special.** `RegisterHotKey` (which the global-shortcut plugin uses) loses the race for PrintScreen whenever another process holds it — Screenpresso, or Windows 11's own Snipping Tool ("Use PrtScn to open screen snipping"), which fails registration with `HotKey already registered`. So PrintScreen is instead grabbed via a **Windows `WH_KEYBOARD_LL` low-level keyboard hook** ([hook_win.rs](src-tauri/src/hook_win.rs), Windows-only, installed from `lib.rs` setup). The hook runs ahead of hotkey dispatch, fires the region overlay on key-up, and **swallows** the keystroke (`return LRESULT(1)`) so the default Snipping Tool is suppressed. The hook lives on a dedicated thread with its own `GetMessageW` pump (required for LL-hook delivery); the AppHandle reaches the C callback via a `OnceLock` static.

### Tray residency

The app runs resident in the system tray (`tray.rs`, built in `lib.rs` setup, requires the `tray-icon` Cargo feature). The `main` window starts with `"visible": false` (tray-only launch) and its `CloseRequested` event is intercepted to **hide instead of quit** — the app only exits via the tray menu's Quit. Left-clicking the tray shows the gallery; the tray menu also exposes the three capture actions and Settings.

### Tauri capabilities

Permissions are declared in `src-tauri/capabilities/default.json`. When adding a new Tauri plugin, add its permission there.
