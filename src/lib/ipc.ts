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

  getScrollMode: () =>
    invoke<boolean>('get_scroll_mode'),

  cancelOverlay: () =>
    invoke<void>('cancel_overlay'),

  completeRegionCapture: (x: number, y: number, width: number, height: number, windowId?: number) =>
    invoke<void>('complete_region_capture', { x, y, width, height, windowId }),

  completeScrollCapture: (x: number, y: number, width: number, height: number) =>
    invoke<void>('complete_scroll_capture', { x, y, width, height }),

  completeWindowCaptureById: (windowId: number) =>
    invoke<void>('complete_window_capture_by_id', { windowId }),

  completeMonitorCapture: (monitorId: number) =>
    invoke<void>('complete_monitor_capture', { monitorId }),

  // Capture-complete toast: click-through to the editor, or dismiss.
  toastOpenEditor: () =>
    invoke<void>('toast_open_editor'),

  toastDismiss: () =>
    invoke<void>('toast_dismiss'),

  // Editor: fetch the captured image. Arrives as a raw binary IPC response
  // (PNG bytes, no base64/JSON round-trip); an empty body means no pending image.
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

  openCapturesFolder: () =>
    invoke<void>('open_captures_folder'),

  openCaptureInEditor: (path: string) =>
    invoke<void>('open_capture_in_editor', { path }),

  openFile: (path: string) =>
    invoke<void>('open_file', { path }),

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
