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

export interface RegionArgs {
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
  notches: number
  settle_ms: number
}

export type OutputFormat = 'png' | 'jpeg'

export interface AppSettings {
  save_dir: string | null
  filename_pattern: string
  output_format: OutputFormat
  jpeg_quality: number
  auto_copy: boolean
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

  getVirtualScreenOrigin: () =>
    invoke<[number, number]>('get_virtual_screen_origin'),

  getWindowsInfo: () =>
    invoke<WindowInfo[]>('get_windows_info'),

  // Screenpresso-style sub-window element rects (UI Automation) for a window
  getElementRects: (windowId: number) =>
    invoke<ElementRect[]>('get_element_rects', { windowId }),

  // Capture flows (high-level — includes auto-save + editor open)
  openRegionOverlay: () =>
    invoke<void>('open_region_overlay'),

  openRegionOverlayScroll: () =>
    invoke<void>('open_region_overlay_scroll'),

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

  doWindowCapture: () =>
    invoke<void>('do_window_capture'),

  doFullscreenCapture: (monitorId?: number) =>
    invoke<void>('do_fullscreen_capture', { monitorId }),

  // Editor: fetch the captured image
  getPendingImage: () =>
    invoke<string | null>('get_pending_image'),

  getPendingPath: () =>
    invoke<string | null>('get_pending_path'),

  // Low-level capture (returns base64 PNG, no side effects)
  captureFullscreen: (monitorId?: number) =>
    invoke<string>('capture_fullscreen', { monitorId }),

  captureActiveWindow: () =>
    invoke<string>('capture_active_window'),

  captureRegion: (args: RegionArgs) =>
    invoke<string>('capture_region', { args }),

  // Clipboard
  copyImageToClipboard: (imageBase64: string) =>
    invoke<void>('copy_image_to_clipboard', { imageBase64 }),

  copyCaptureToClipboard: (path: string) =>
    invoke<void>('copy_capture_to_clipboard', { path }),

  // Storage
  saveImage: (imageBase64: string, suggestedName?: string) =>
    invoke<string>('save_image', { imageBase64, suggestedName }),

  overwriteImage: (path: string, imageBase64: string) =>
    invoke<string>('overwrite_image', { path, imageBase64 }),

  autoSaveImage: (imageBase64: string) =>
    invoke<string>('auto_save_image', { imageBase64 }),

  listCaptures: () =>
    invoke<CaptureEntry[]>('list_captures'),

  deleteCapture: (path: string) =>
    invoke<void>('delete_capture', { path }),

  getCapturesDir: () =>
    invoke<string>('get_captures_dir'),

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

  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>('update_settings', { settings }),

  pickDirectory: (current: string | null) =>
    invoke<string | null>('pick_directory', { current }),

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
