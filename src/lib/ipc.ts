import { invoke } from '@tauri-apps/api/core'

// ===== Types =====

export interface MonitorInfo {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  scale_factor: number
  is_primary: boolean
}

export interface RecordingMonitorInfo {
  index: number
  name: string
  width: number
  height: number
  x: number
  y: number
  is_primary: boolean
}

export interface WindowInfo {
  id: number
  title: string
  x: number
  y: number
  width: number
  height: number
}

/** Bounding rect of a UI Automation element within a window, in physical pixels. */
export interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureEntry {
  path: string
  filename: string
  created_at: number
  thumbnail_base64: string
  width: number
  height: number
  file_type: 'image' | 'video'
  favorite: boolean
}

export interface RecordingSettings {
  format: string
  mp4_fps: number
  gif_fps: number
  gif_max_width: number
}

export interface ScrollSettings {
  settle_ms: number
}

/** Last-used Fixed Capture window selection, remembered across restarts. */
export interface FixedCaptureSettings {
  kind: 'ratio' | 'size'
  w: number
  h: number
}

/** The active selection constraint for the current overlay session (or none),
 *  set by the Fixed Capture window right before opening the overlay. */
export interface FixedRegionSpec {
  is_ratio: boolean
  w: number
  h: number
}

export type OutputFormat = 'png' | 'jpeg'

export interface AppSettings {
  save_dir: string | null
  filename_pattern: string
  output_format: OutputFormat
  jpeg_quality: number
  open_editor_after_capture: boolean
  capture_cursor: boolean
  launch_on_startup: boolean
  onboarded: boolean
  language: 'en' | 'ja'
  recording: RecordingSettings
  scroll: ScrollSettings
  fixed_capture: FixedCaptureSettings
}

// ===== IPC wrappers =====

export const ipc = {
  // Monitor / screen info
  getMonitors: () =>
    invoke<MonitorInfo[]>('get_monitors'),

  getWindowsInfo: () =>
    invoke<WindowInfo[]>('get_windows_info'),

  // Screenpresso-style sub-window element rects (UI Automation) for a window
  getElementRects: (windowId: number) =>
    invoke<ElementRect[]>('get_element_rects', { windowId }),

  // Capture flows (high-level — includes auto-save + editor open)
  openRegionOverlay: () =>
    invoke<void>('open_region_overlay'),

  /** Ctrl+PrintScreen's action: captures the monitor under the cursor straight
   *  away, with no overlay and no window activation. */
  doCursorMonitorCapture: () =>
    invoke<void>('do_cursor_monitor_capture'),

  getScrollMode: () =>
    invoke<boolean>('get_scroll_mode'),

  // Opens the overlay with the selection constrained to a fixed size/ratio.
  // `kind` "ratio" locks w:h proportions; "size" locks the exact pixel
  // dimensions and turns the overlay into click-to-capture at the cursor.
  openFixedCaptureOverlay: (kind: 'ratio' | 'size', w: number, h: number) =>
    invoke<void>('open_region_overlay_fixed', { kind, w, h }),

  getFixedRegion: () =>
    invoke<FixedRegionSpec | null>('get_fixed_region'),

  cancelOverlay: () =>
    invoke<void>('cancel_overlay'),

  completeRegionCapture: (x: number, y: number, width: number, height: number, windowId?: number) =>
    invoke<void>('complete_region_capture', { x, y, width, height, windowId }),

  completeScrollCapture: (x: number, y: number, width: number, height: number, windowId?: number) =>
    invoke<void>('complete_scroll_capture', { x, y, width, height, windowId }),

  completeWindowCaptureById: (windowId: number) =>
    invoke<void>('complete_window_capture_by_id', { windowId }),

  completeMonitorCapture: (monitorId: number) =>
    invoke<void>('complete_monitor_capture', { monitorId }),

  // Capture-complete toast: click-through to the editor, or dismiss.
  toastOpenEditor: () =>
    invoke<void>('toast_open_editor'),

  toastDismiss: () =>
    invoke<void>('toast_dismiss'),

  // Editor: fetch the image THIS editor window was opened on (the backend keys
  // it by the calling window's label, since several editors can be open at
  // once). Arrives as a raw binary IPC response (PNG bytes, no base64/JSON
  // round-trip); an empty body means no document for this window.
  getPendingImage: () =>
    invoke<ArrayBuffer>('get_pending_image').then((buf) =>
      buf && buf.byteLength > 0 ? buf : null,
    ),

  getPendingPath: () =>
    invoke<string | null>('get_pending_path'),

  // Overlay: fetch this window's own slice of the PrintScreen-time frozen
  // desktop snapshot (raw PNG bytes, same pattern as getPendingImage). Pass
  // this overlay's own physical bounds; null means no frozen frame available.
  getFrozenFrame: (x: number, y: number, width: number, height: number) =>
    invoke<ArrayBuffer>('get_frozen_frame', { x, y, width, height }).then((buf) =>
      buf && buf.byteLength > 0 ? buf : null,
    ),

  /** Writes one line into `clipse.log` from a frontend window. For failures a
   *  user can't otherwise see — the overlay's especially, since a webview
   *  console is unreachable in a release build and an unpainted transparent
   *  overlay looks exactly like the hotkey not firing. */
  logDiag: (message: string) =>
    invoke<void>('log_diag', { message }),

  // Clipboard
  copyImageToClipboard: (imageBase64: string) =>
    invoke<void>('copy_image_to_clipboard', { imageBase64 }),

  // PNG bytes travel as a raw binary IPC body — no base64/JSON round-trip,
  // markedly faster for large images.
  copyImageBytesToClipboard: (bytes: Uint8Array) =>
    invoke<void>('copy_image_bytes_to_clipboard', bytes),

  copyCaptureToClipboard: (path: string) =>
    invoke<void>('copy_capture_to_clipboard', { path }),

  copyFileToClipboard: (path: string) =>
    invoke<void>('copy_file_to_clipboard', { path }),

  // Annotation clipboard — Clipse-internal, not the OS clipboard. Kept in the
  // backend so elements copied in one editor window can be pasted in another
  // (each editor window is a separate webview with its own store). `json` is an
  // `AnnotationClipboardPayload`; `seq` identifies the payload so a pasting
  // window can tell a new copy from the one it already pasted.
  setAnnotationClipboard: (json: string) =>
    invoke<number>('set_annotation_clipboard', { json }),

  getAnnotationClipboard: () =>
    invoke<{ seq: number; json: string } | null>('get_annotation_clipboard'),

  // Pin to Screen: pins an image as a small always-on-top floating window.
  // Several can be open at once (see Pin.tsx), unlike the single-slot
  // getPendingImage — each pin fetches its own bytes by its own window label.
  pinImageBytes: (bytes: Uint8Array) =>
    invoke<void>('pin_image_bytes', bytes),

  pinCaptureByPath: (path: string) =>
    invoke<void>('pin_capture_by_path', { path }),

  getPinnedImage: (label: string) =>
    invoke<ArrayBuffer>('get_pinned_image', { label }).then((buf) =>
      buf && buf.byteLength > 0 ? buf : null,
    ),

  // Storage
  saveImage: (imageBase64: string, suggestedName?: string) =>
    invoke<string>('save_image', { imageBase64, suggestedName }),

  overwriteImage: (path: string, imageBase64: string) =>
    invoke<string>('overwrite_image', { path, imageBase64 }),

  listCaptures: () =>
    invoke<CaptureEntry[]>('list_captures'),

  deleteCapture: (path: string) =>
    invoke<void>('delete_capture', { path }),

  /** Renames a capture to `newName` (base name, no extension). Returns the new path. */
  renameCapture: (path: string, newName: string) =>
    invoke<string>('rename_capture', { path, newName }),

  /** Toggles a capture's favorite ("important") mark. Returns the new state. */
  toggleFavorite: (path: string) =>
    invoke<boolean>('toggle_favorite', { path }),

  openCapturesFolder: () =>
    invoke<void>('open_captures_folder'),

  openCaptureInEditor: (path: string) =>
    invoke<void>('open_capture_in_editor', { path }),

  openFile: (path: string) =>
    invoke<void>('open_file', { path }),

  // Annotation sidecars (re-editable captures). `origBase64` is only sent
  // when the pristine base image isn't stashed yet or changed (crop).
  saveSidecar: (path: string, annotationsJson: string, origBase64?: string) =>
    invoke<void>('save_sidecar', { path, annotationsJson, origBase64 }),

  getPendingAnnotations: () =>
    invoke<string | null>('get_pending_annotations'),

  deleteSidecar: (path: string) =>
    invoke<void>('delete_sidecar', { path }),

  // OCR
  runOcr: (imageBase64: string) =>
    invoke<string>('run_ocr', { imageBase64 }),

  // Settings
  getSettings: () =>
    invoke<AppSettings>('get_settings'),

  openSettings: () =>
    invoke<void>('open_settings'),

  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>('update_settings', { settings }),

  pickDirectory: (current: string | null) =>
    invoke<string | null>('pick_directory', { current }),

  getAppVersion: () =>
    invoke<string>('get_app_version'),

  // Screen recording
  listRecordingMonitors: () =>
    invoke<RecordingMonitorInfo[]>('list_recording_monitors'),

  openRecorder: () =>
    invoke<void>('open_recorder'),

  startRecording: (format: 'mp4' | 'gif', monitorIndex?: number) =>
    invoke<void>('start_recording', { format, monitorIndex }),

  stopRecording: () =>
    invoke<string>('stop_recording'),

  isRecording: () =>
    invoke<boolean>('is_recording'),
}
