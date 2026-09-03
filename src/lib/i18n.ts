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
  shortcutRecording: {
    en: 'Listening — press the new combination now. Esc cancels, and the old shortcut stays.',
    ja: '入力待ちです。新しいキーの組み合わせを押してください。Escでキャンセルすると元のショートカットのままになります。',
  },
  shortcutsHint: {
    en: 'Click a shortcut and press the new combination. Most keys need Ctrl, Alt or Shift; PrintScreen works on its own. Alt+PrintScreen and Win+PrintScreen stay with Windows.',
    ja: 'ショートカットをクリックしてから新しいキーを押してください。ほとんどのキーは Ctrl・Alt・Shift のいずれかが必要ですが、PrintScreen は単独で使えます。Alt+PrintScreen と Win+PrintScreen は Windows 標準の機能なので変更できません。',
  },
  scrollSettleHint: {
    en: 'Delay after each scroll before capturing, to let the page finish rendering. Increase for slow or animated pages.',
    ja: 'スクロール後にキャプチャするまでの待機時間。ページの描画完了を待つためのものです。読み込みが遅い、またはアニメーションのあるページでは値を増やしてください。',
  },
  ocrEngineHint: {
    en: 'OCR runs through an agentic coding CLI, which must already be installed and signed in. The captured image is sent to its provider (Anthropic or OpenAI) to be read. Auto uses whichever of the two is found on PATH.',
    ja: 'OCRはエージェント型のコーディングCLIを呼び出して実行します。あらかじめインストールとサインインを済ませておく必要があります。読み取りのため、キャプチャ画像はそのCLIの提供元（Anthropic または OpenAI）へ送信されます。Autoの場合、PATH上で見つかった方を使用します。',
  },
  updateHint: {
    en: 'Clipse checks its public GitHub release page. Only the version file is requested — no usage data or capture content is sent. Each update is verified against Clipse’s signing key before it is installed.',
    ja: 'Clipseは公開されているGitHubのリリースページを参照します。取得するのはバージョン情報のみで、利用状況やキャプチャ内容が送信されることはありません。各更新はインストール前にClipseの署名鍵で検証されます。',
  },
  updateNone: {
    en: 'You are on the latest version.',
    ja: '最新のバージョンをご利用中です。',
  },
  updateDownloading: {
    en: 'Downloading and verifying the update —',
    ja: '更新をダウンロードして検証しています —',
  },
  updateReady: {
    en: 'The update is installed. Restart Clipse to finish — captures in an open editor are not saved automatically.',
    ja: '更新をインストールしました。完了するにはClipseを再起動してください。開いているエディタの内容は自動保存されません。',
  },
  ocrConsentBody: {
    en: 'OCR does not run on this machine. The captured image is sent to an external AI provider — Anthropic or OpenAI, depending on which CLI is used — to be read, and is handled under that provider’s terms and privacy policy. Everything else in Clipse stays on your device. You can withdraw this at any time in Settings.',
    ja: 'OCRはこの端末では実行されません。読み取りのため、キャプチャ画像は外部のAI提供元（使用するCLIに応じて Anthropic または OpenAI）へ送信され、その提供元の利用規約およびプライバシーポリシーに従って扱われます。Clipseのその他の機能はすべて端末内で完結します。この同意は設定画面でいつでも取り消せます。',
  },
  ocrConsentRevoked: {
    en: 'OCR is off. It stays unavailable until you agree to the image being sent to an external AI provider.',
    ja: 'OCRは無効です。キャプチャ画像を外部のAI提供元へ送信することに同意するまで使用できません。',
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
  fixedCaptureHintRatio: {
    en: 'Drag to select — the selection is locked to this ratio.',
    ja: 'ドラッグして範囲を選択してください。選択範囲はこの比率に固定されます。',
  },
  fixedCaptureHintSize: {
    en: 'Click to capture — the selection is fixed at this exact size.',
    ja: 'クリックでキャプチャします。選択範囲はこのサイズちょうどに固定されます。',
  },
  overlayHintFixedRatio: {
    en: 'Drag to select (locked to {value}) · Esc to cancel',
    ja: 'ドラッグで範囲選択(比率 {value} に固定) · Escでキャンセル',
  },
  overlayHintFixedSize: {
    en: 'Click to capture at {value} · Esc to cancel',
    ja: 'クリックで {value} のサイズでキャプチャ · Escでキャンセル',
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
  lblOcrEngine:       { en: 'Engine',             ja: 'エンジン' },
  lblOcrConsent:      { en: 'Send images for OCR', ja: 'OCRのため画像を送信' },
  lblCurrentVersion:  { en: 'Current version',    ja: '現在のバージョン' },
  lblUpdateCheck:     { en: 'Updates',            ja: '更新' },
  lblShortcutCapture:   { en: 'Region capture',   ja: '領域キャプチャ' },
  lblShortcutQuickMenu: { en: 'Quick menu',       ja: 'クイックメニュー' },
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
