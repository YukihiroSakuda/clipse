// Lightweight i18n for prose-only text (hints, explanations, notes). Button
// captions, labels, and section titles stay in English regardless of this
// setting — see CLAUDE.md's UI language rules.

export type Lang = 'en' | 'ja'

const dict = {
  filenamePatternHint: {
    en: 'Tokens: {date} YYMMDD, {time} HHMMSS, {ts} unix. Default: clipse_{date}{time}',
    ja: 'トークン: {date} は YYMMDD形式、{time} は HHMMSS形式、{ts} はUNIX秒。デフォルト: clipse_{date}{time}',
  },
  openEditorAfterCaptureHint: {
    en: 'Off: a notification appears at the corner of the captured monitor — click it to edit. The image is always copied to the clipboard either way.',
    ja: 'オフの場合、キャプチャしたモニタの隅に通知が表示され、クリックするとエディタが開きます。どちらの場合も画像は常にクリップボードへコピーされます。',
  },
  scrollSettleHint: {
    en: 'Delay after each scroll before capturing, to let the page finish rendering. Increase for slow or animated pages.',
    ja: 'スクロール後にキャプチャするまでの待機時間。ページの描画完了を待つためのものです。読み込みが遅い、またはアニメーションのあるページでは値を増やしてください。',
  },
  overlayHintRegion: {
    en: 'Click to capture · Scroll to narrow · Drag for free region · Esc to cancel',
    ja: 'クリックでキャプチャ · スクロールで絞り込み · ドラッグで自由選択 · Escでキャンセル',
  },
  overlayHintScroll: {
    en: 'Scrolling capture · Select the scrollable area · Esc to cancel',
    ja: 'スクロールキャプチャ · スクロール可能な範囲を選択 · Escでキャンセル',
  },
  overlayHintCaptureFailed: {
    en: 'Capture failed. Press Esc to close.',
    ja: 'キャプチャに失敗しました。Escで閉じます。',
  },
  overlayHintDragConfirm: {
    en: 'Drag to select region · Enter to confirm · Esc to cancel',
    ja: 'ドラッグで範囲選択 · Enterで確定 · Escでキャンセル',
  },
  recorderMonitorsDetected: {
    en: '{count} monitors detected.',
    ja: '{count}台のモニターを検出しました。',
  },

  // ── About window ──
  aboutTagline: {
    en: 'Capture, annotate, and share your screen — fast.',
    ja: 'スクリーンをすばやくキャプチャ・注釈・共有。',
  },
  aboutFeatureCaptureDesc: {
    en: 'Region, window, or fullscreen — select with PrintScreen.',
    ja: '領域・ウィンドウ・全画面をPrintScreenで選択してキャプチャ。',
  },
  aboutFeatureScrollDesc: {
    en: 'Stitches a scrollable area into one tall image.',
    ja: 'スクロール可能な範囲を1枚の縦長画像につなぎ合わせます。',
  },
  aboutFeatureRecordDesc: {
    en: 'Record the screen to video or GIF.',
    ja: '画面を動画またはGIFとして録画します。',
  },
  aboutFeatureAnnotateDesc: {
    en: 'Arrows, shapes, text, blur/spotlight, numbered markers, pen.',
    ja: '矢印・図形・テキスト・ぼかし/スポットライト・番号マーカー・ペン。',
  },
  aboutFeatureOcrDesc: {
    en: 'Extract text straight out of a captured image.',
    ja: 'キャプチャした画像からテキストを抽出します。',
  },
  aboutFeatureTrayDesc: {
    en: 'Runs in the tray — always one hotkey or click away.',
    ja: 'トレイに常駐し、ホットキーやクリックでいつでも呼び出せます。',
  },

  // ── Settings window: row labels (item names) only. Section titles, the
  // header, and the Save button stay English — see CLAUDE.md's UI rules. ──
  lblExplanatoryText: { en: 'Explanatory text',   ja: '説明文の言語' },
  lblSaveFolder:      { en: 'Save folder',        ja: '保存先フォルダ' },
  lblFilenamePattern: { en: 'Filename pattern',   ja: 'ファイル名パターン' },
  lblFormat:          { en: 'Format',             ja: '形式' },
  lblJpegQuality:     { en: 'JPEG quality',       ja: 'JPEG画質' },
  lblOpenEditorAfterCapture: { en: 'Open editor after capture', ja: 'キャプチャ後にエディタを開く' },
  lblCaptureCursor:   { en: 'Include cursor in captures',      ja: 'カーソルを含める' },
  lblLaunchStartup:   { en: 'Launch on system startup',        ja: 'システム起動時に起動' },
  lblWaitTime:        { en: 'Wait time',          ja: '待機時間' },
  settingsDefaultDir: { en: 'Default (app data)', ja: 'デフォルト（アプリデータ）' },
} as const

export type TKey = keyof typeof dict

/** Translates `key` into `lang`, substituting `{name}` placeholders from `vars`. */
export function t(key: TKey, lang: Lang, vars?: Record<string, string | number>): string {
  let text: string = dict[key][lang]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}
