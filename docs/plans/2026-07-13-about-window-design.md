# About Clipse window — design

## Goal

Add an "About Clipse" introduction page, reachable from the tray menu, that shows
basic app identity plus a short list of main features. No external links, no
keyboard-shortcut cheat sheet (explicitly out of scope per user decision).

## Architecture

New window, following the exact pattern already used for `settings`:

- Rust: `window::open_about(app)` — mirrors `open_settings`: if a webview window
  labeled `about` already exists, show/unminimize/focus it; otherwise build one.
- Frontend: `src/routes/About.tsx`, routed in `App.tsx` via
  `if (label === 'about') return <About />`.
- `src-tauri/tauri.conf.json`: no static window entry needed (built dynamically
  like `settings`/`recorder`), but `src-tauri/capabilities/default.json`'s
  `windows` list must include `"about"`.
- Version number: add a tiny `get_app_version` Tauri command
  (`app.package_info().version.to_string()`), wrapped as `ipc.getAppVersion()` —
  keeps with the project rule that components never call `invoke()` directly,
  and avoids adding a new `core:app:*` permission just for this.

## Window spec

- Label: `about`, title: "About Clipse"
- Size: 420×520, not resizable, `decorations: false` (custom header + close
  button, same chrome as Settings), centered, single instance.
- `disable_browser_accelerator_keys` applied on Windows, same as other custom
  windows.

## Content

Header (structural — stays English per CLAUDE.md UI rules):
- App icon: `public/icon.png` (already present, servable at `/icon.png`)
- "Clipse" title
- One-line tagline (prose — translatable via `i18n.ts`)
- Version badge, e.g. `v0.1.2`, from `ipc.getAppVersion()`

Feature list (6 items, icon + short English title + one-line description).
Titles are short structural labels (English always); descriptions are prose
and go through the existing `t(key, lang)` i18n pattern, same as
`scrollSettleHint` etc. in `src/lib/i18n.ts`:

1. Region / Window / Fullscreen capture — PrintScreen overlay-based selection
2. Scrolling capture — stitches a scrollable area into one image
3. Screen recording — record to video/GIF
4. Annotations — arrows, shapes, text, blur/spotlight, numbered markers, pen
5. OCR — extract text from captured images
6. Tray-resident — reachable anytime via global hotkeys and the tray menu

## Menu integration

Tray menu (`src-tauri/src/tray.rs`): add `about` `MenuItem` labeled
"About Clipse", positioned between `gallery` and `settings`. Its handler calls
`window::open_about(app)`, matching the `settings` handler's error-logging
style.

## Styling

New `src/routes/About.module.css`, reusing the same Studio Dark tokens
(colors, spacing, font stack) as `Settings.module.css` for visual consistency.

## Testing

UI-only addition — verified via:
- `npx tsc --noEmit` (typecheck)
- Manual check in the running app: tray → "About Clipse" opens the window;
  clicking again while open focuses the existing window instead of
  duplicating it; close button works; content renders correctly in both
  `en`/`ja` language settings.
