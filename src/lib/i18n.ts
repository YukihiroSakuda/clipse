// Lightweight i18n for prose-only text (hints, explanations, notes). Button
// captions, labels, and section titles stay in English regardless of this
// setting — see CLAUDE.md's UI language rules.

export type Lang = 'en' | 'ja'

const dict = {
  filenamePatternHint: {
    en: 'Tokens: {date} YYYYMMDD, {time} HHMMSS, {ts} unix. Default: clipse_{date}_{time}',
    ja: 'トークン: {date} は YYYYMMDD形式、{time} は HHMMSS形式、{ts} はUNIX秒。デフォルト: clipse_{date}_{time}',
  },
  scrollNotchesHint: {
    en: 'Wheel clicks sent per step. Smaller steps overlap more between frames, which helps alignment on pages with fast-changing content.',
    ja: '1ステップあたりに送信するホイールクリック数。値を小さくするとフレーム間の重なりが増え、変化の速いページでの位置合わせに役立ちます。',
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
  recorderPrimaryMonitorHint: {
    en: 'Records the primary monitor.',
    ja: 'プライマリモニターを録画します。',
  },
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
