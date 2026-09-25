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
    en: 'Click to capture · Scroll to narrow · Drag for free region (Shift: square) · R ratio · L last size · Shift+L last region · S scrolling capture · Esc to cancel',
    ja: 'クリックでキャプチャ · スクロールで絞り込み · ドラッグで自由選択(Shiftで正方形) · Rで比率 · Lで前回サイズ · Shift+Lで前回位置 · Sでスクロールキャプチャ · Escでキャンセル',
  },
  overlayHintScroll: {
    en: 'Scrolling capture · Select the scrollable area · S back to normal capture · Esc to cancel',
    ja: 'スクロールキャプチャ · スクロール可能な範囲を選択 · Sで通常キャプチャに戻る · Escでキャンセル',
  },
  overlayHintCaptureFailed: {
    en: 'Capture failed. Press Esc to close.',
    ja: 'キャプチャに失敗しました。Escで閉じます。',
  },
  overlayHintDragConfirm: {
    en: 'Drag to select region · Shift square · R ratio · Enter to confirm · Esc to cancel',
    ja: 'ドラッグで範囲選択 · Shiftで正方形 · Rで比率 · Enterで確定 · Escでキャンセル',
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
  // The same two modes when entered with the overlay's own keys (R / L), so
  // the hint names the key that steps on or leaves them.
  overlayHintKeyRatio: {
    en: 'Drag to select (locked to {value}) · R next ratio · Shift+R previous · Esc to cancel',
    ja: 'ドラッグで範囲選択(比率 {value} に固定) · Rで次の比率 · Shift+Rで前の比率 · Escでキャンセル',
  },
  overlayHintKeySize: {
    en: 'Click to capture at the last size ({value}) · L to release · Esc to cancel',
    ja: 'クリックで前回サイズ({value})をキャプチャ · Lで解除 · Escでキャンセル',
  },
  overlayHintLastPosition: {
    en: 'Enter or click inside to capture the last region ({value}) · Click outside to release · Esc to cancel',
    ja: 'Enterまたは枠内クリックで前回の範囲({value})をキャプチャ · 枠外クリックで解除 · Escでキャンセル',
  },
  overlayHintNoLastRegion: {
    en: 'No previous region yet — drag to select one · Esc to cancel',
    ja: '前回の範囲がまだありません。ドラッグで選択してください · Escでキャンセル',
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

  // ── Help modal: shortcut descriptions. Section titles ("Quick menu",
  // "Gallery", "Editor — tools", "Editor — actions", "Global shortcuts"), the
  // modal title, and key labels (Enter/Esc/Ctrl/…) stay English — see
  // CLAUDE.md's UI rules. ──
  helpGlobalCapture: { en: 'Region capture overlay', ja: '領域選択のオーバーレイを開く' },
  helpGlobalQuickMenu: {
    en: 'Quick menu at the cursor — every other capture action',
    ja: 'カーソル位置にクイックメニューを表示（他のキャプチャ操作全般）',
  },
  helpQmMove: { en: 'Move the selection', ja: '選択を移動' },
  helpQmRun: { en: 'Run the selected action', ja: '選択した操作を実行' },
  helpQmRunByNumber: { en: 'Run an action directly by its number', ja: '番号で操作を直接実行' },
  helpQmClose: { en: 'Close', ja: '閉じる' },
  helpOvSquare: { en: 'Hold while dragging to select a square', ja: 'ドラッグ中に押している間、正方形で選択' },
  helpOvRatio: {
    en: 'Lock the drag to the next ratio (1:1, 4:3, 16:9, 3:2, 3:4, 9:16, free); Shift+R goes back',
    ja: 'ドラッグを次の比率に固定（1:1・4:3・16:9・3:2・3:4・9:16・自由）。Shift+Rで逆順',
  },
  helpOvLastSize: {
    en: 'A rect the size of the last capture follows the cursor; click to capture',
    ja: '前回キャプチャと同じサイズの枠がカーソルに追従。クリックでキャプチャ',
  },
  helpOvScroll: {
    en: 'Switch between a normal and a scrolling capture',
    ja: '通常キャプチャとスクロールキャプチャを切り替え',
  },
  helpOvLastPosition: {
    en: 'Show the last region where it was; Enter or click inside to capture',
    ja: '前回の範囲を同じ位置に表示。Enterまたは枠内クリックでキャプチャ',
  },
  helpGalMove: {
    en: 'Move between captures (up/down move a whole row)',
    ja: 'キャプチャ間を移動（上下は行単位で移動）',
  },
  helpGalOpen: {
    en: 'Open the current capture — editor for an image, player for a video',
    ja: '選択中のキャプチャを開く（画像はエディタ、動画はプレーヤー）',
  },
  helpGalJump: { en: 'Jump to the first / last capture', ja: '最初/最後のキャプチャへ移動' },
  helpGalCopy: {
    en: 'Copy the current capture — image to the clipboard, video as a file',
    ja: '選択中のキャプチャをコピー（画像はクリップボードへ、動画はファイルとして）',
  },
  helpGalCopyPath: { en: 'Copy the file path', ja: 'ファイルパスをコピー' },
  helpGalPin: { en: 'Pin to screen (images only)', ja: '画面にピン留め（画像のみ）' },
  helpGalSelectAll: { en: 'Select all', ja: 'すべて選択' },
  helpGalDelete: { en: 'Delete selected (Enter then confirms)', ja: '選択項目を削除（Enterで確定）' },
  helpGalCancel: {
    en: 'Cancel, then deselect, then close the window',
    ja: 'キャンセル → 選択解除 → ウィンドウを閉じる、の順に動作',
  },
  helpGalDblClick: { en: 'Open in editor', ja: 'エディタで開く' },
  helpGalDragOut: {
    en: 'Copy the file into Explorer, mail or a chat window (drags the whole selection)',
    ja: 'ファイルをエクスプローラーやメール、チャットへドラッグしてコピー（選択項目全体をドラッグ）',
  },
  helpEdToolSelect: { en: 'Select', ja: '選択' },
  helpEdToolArrow: { en: 'Arrow', ja: '矢印' },
  helpEdToolPen: { en: 'Pen (freehand)', ja: 'ペン（フリーハンド）' },
  helpEdToolRect: { en: 'Rectangle', ja: '四角形' },
  helpEdToolEllipse: { en: 'Ellipse', ja: '楕円' },
  helpEdToolText: { en: 'Text', ja: 'テキスト' },
  helpEdToolNumber: { en: 'Number marker', ja: '番号マーカー' },
  helpEdToolHighlight: { en: 'Highlight', ja: 'ハイライト' },
  helpEdToolSpotlight: { en: 'Spotlight', ja: 'スポットライト' },
  helpEdToolMagnifier: { en: 'Magnifier callout', ja: '拡大コールアウト' },
  helpEdToolBlur: { en: 'Blur / redact', ja: 'ぼかし/黒塗り' },
  helpEdToolMagicWand: { en: 'Magic Wand — select a color range', ja: 'マジックワンド（色の範囲を選択）' },
  helpEdToolCrop: { en: 'Crop', ja: '切り抜き' },
  helpEdActUndo: { en: 'Undo', ja: '元に戻す' },
  helpEdActRedo: { en: 'Redo', ja: 'やり直す' },
  helpEdActSelectAll: { en: 'Select all annotations', ja: 'すべての注釈を選択' },
  helpEdActCopy: {
    en: 'Copy selected annotations, or the image itself if nothing is selected',
    ja: '選択した注釈をコピー（未選択時は画像自体をコピー）',
  },
  helpEdActCopyPath: { en: 'Copy the file path', ja: 'ファイルパスをコピー' },
  helpEdActOcr: { en: 'OCR — extract text from the image', ja: 'OCR（画像からテキストを抽出）' },
  helpEdActPin: {
    en: 'Pin to screen (asks first — pinning closes this editor)',
    ja: '画面にピン留め（確認あり。ピン留めするとこのエディタは閉じます）',
  },
  helpEdActPaste: {
    en: 'Paste an image from the clipboard, or copied annotations — whichever was copied last (annotations may come from another open editor window)',
    ja: 'クリップボードの画像、またはコピーした注釈のうち直近にコピーした方を貼り付け（注釈は別のエディタウィンドウからの場合あり）',
  },
  helpEdActDuplicate: { en: 'Duplicate selection', ja: '選択を複製' },
  helpEdActSave: { en: 'Save to gallery', ja: 'ギャラリーに保存' },
  helpEdActResetZoom: { en: 'Reset zoom / pan', ja: 'ズーム/表示位置をリセット' },
  helpEdActNudge: { en: 'Nudge selection 1px (Shift: 10px)', ja: '選択を1pxずつ移動（Shiftで10px）' },
  helpEdActDelete: {
    en: 'Delete selected annotation, or the image itself if nothing is selected (confirm required)',
    ja: '選択した注釈を削除（未選択時は画像自体を削除、要確認）',
  },
  helpEdActDblClick: { en: 'Edit a text label or number marker', ja: 'テキストラベルや番号マーカーを編集' },
  helpEdActConfirm: {
    en: 'Confirm text/number edit, apply crop, or confirm image delete',
    ja: 'テキスト/番号の編集確定、切り抜きの適用、画像削除の確定',
  },
  helpEdActCancel: {
    en: 'Cancel crop/edit, then deselect, then close this editor',
    ja: '切り抜き/編集をキャンセル → 選択解除 → このエディタを閉じる、の順に動作',
  },
  helpEdActZoom: { en: 'Zoom in / out', ja: 'ズームイン/アウト' },
  helpEdActPan: { en: 'Pan canvas', ja: 'キャンバスをパン（表示位置を移動）' },
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
