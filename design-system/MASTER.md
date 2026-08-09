# Design System — Studio Dark

## Overview

**Concept**: プロフェッショナルダークスタジオ。Figma / VS Code 系の暗い作業空間。
キャプチャ画像が暗いフレームの中で浮き上がり、注釈ツールが明確に識別できる設計。

**Principle**: スクリーンショットが主役、UIはその脇役。Chrome は控えめに、操作は最小。

---

## Color Tokens

```css
:root {
  /* === Backgrounds === */
  --color-bg:          #0F1117;  /* アプリ全体の最暗背景 */
  --color-surface:     #1C1F2E;  /* パネル・サイドバー */
  --color-panel:       #252836;  /* ヘッダーバー・ツールバー */
  --color-panel-hover: #2E3247;  /* パネル hover */
  --color-border:      #2A2D3E;  /* 境界線 */
  --color-border-subtle: #1E2130; /* 薄い区切り */

  /* === Text === */
  --color-text-primary: #E8EAF0; /* 主要テキスト */
  --color-text-muted:   #6B7280; /* 補助テキスト */
  --color-text-faint:   #3D4155; /* 非アクティブ */

  /* === Accent === */
  --color-accent:       #4F8EF7; /* Electric Blue — メインアクセント */
  --color-accent-hover: #3B7DE8;
  --color-accent-dim:   rgba(79, 142, 247, 0.15); /* 選択ハイライト背景 */
  --color-accent-alt:   #7C6BF8; /* Violet — セカンダリ */

  /* === Semantic === */
  --color-success:  #10B981; /* 保存完了・コピー完了 Toast */
  --color-warning:  #F59E0B; /* OCR 注意 */
  --color-danger:   #EF4444; /* 削除・エラー */
  --color-info:     #4F8EF7; /* 情報 (accent と同値) */

  /* === Annotation Tool Colors (user-selectable) === */
  --ann-red:    #EF4444;
  --ann-orange: #F97316;
  --ann-yellow: #EAB308;
  --ann-green:  #22C55E;
  --ann-blue:   #3B82F6;
  --ann-purple: #A855F7;
  --ann-white:  #F8FAFC;
  --ann-black:  #0F172A;
}
```

---

## Typography

```css
:root {
  /* Font Families */
  --font-ui:   'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace; /* OCR結果・パス表示 */

  /* Scale (base 13px for dense tool UI) */
  --fs-xs:   11px;  /* メタ情報、ショートカットヒント */
  --fs-sm:   12px;  /* ツールラベル、ステータス */
  --fs-base: 13px;  /* 主要UI文字 */
  --fs-md:   14px;  /* パネルタイトル */
  --fs-lg:   16px;  /* セクション見出し */
  --fs-xl:   20px;  /* 画面タイトル (ギャラリー等) */

  /* Weight */
  --fw-normal:   400;
  --fw-medium:   500;
  --fw-semibold: 600;

  /* Line Height */
  --lh-tight:  1.25;
  --lh-normal: 1.5;
}
```

---

## Spacing (8px grid)

```css
:root {
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-5:  20px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-10: 40px;
  --sp-12: 48px;
}
```

---

## Border Radius

```css
:root {
  --radius-sm: 4px;   /* ツールボタン */
  --radius-md: 6px;   /* パネル内カード */
  --radius-lg: 10px;  /* メインパネル */
  --radius-xl: 14px;  /* モーダル、サムネイルカード */
  --radius-full: 9999px; /* バッジ、タグ */
}
```

---

## Shadows

```css
:root {
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-3: 0 8px 20px rgba(0, 0, 0, 0.5);   /* フローティングツールバー */
  --shadow-4: 0 16px 40px rgba(0, 0, 0, 0.6);  /* モーダル */
}
```

---

## Transitions

```css
:root {
  --t-fast:   100ms ease;
  --t-normal: 180ms ease;
  --t-slow:   280ms ease;
}

/* 標準パターン */
.interactive { transition: background var(--t-fast), color var(--t-fast); }
```

---

## Z-Index Scale

```css
:root {
  --z-canvas:   10;   /* 注釈 Canvas */
  --z-toolbar:  20;   /* エディタツールバー */
  --z-panel:    30;   /* OCRパネル等 */
  --z-overlay:  40;   /* キャプチャ選択オーバーレイ */
  --z-toast:    50;   /* Toast 通知 */
  --z-modal:    60;   /* モーダルダイアログ */
}
```

---

## Component Specs

### Header Bar (エディタ上部)

```
高さ: 44px
背景: var(--color-panel)
境界線下: 1px solid var(--color-border)
パディング: 0 var(--sp-4)
レイアウト: flex, space-between, align-center
```

### Toolbar (フローティング)

```
背景: var(--color-panel)
border: 1px solid var(--color-border)
border-radius: var(--radius-lg)
shadow: var(--shadow-3)
padding: var(--sp-2) var(--sp-3)
gap: var(--sp-1)
```

### Tool Button

```
サイズ: 32×32px (min touch: 44px は右クリックメニュー等で確保)
border-radius: var(--radius-sm)
アクティブ時: background var(--color-accent-dim), color var(--color-accent)
hover 時: background var(--color-panel-hover)
アイコン: Lucide React (20px stroke-width 1.5)
```

### Canvas (注釈エディタ中心領域)

```
背景: var(--color-bg)
キャプチャ画像: ドロップシャドウ var(--shadow-3) で浮かせる
余白: var(--sp-6) 以上確保
```

### Selection Overlay (キャプチャオーバーレイ)

```
背景: rgba(0, 0, 0, 0.55)
選択矩形枠: 2px solid var(--color-accent)
選択矩形内: クリア (マスク外側のみ暗化)
寸法ツールチップ: var(--color-panel) bg, var(--color-text-primary) text, var(--radius-sm)
```

### Gallery Card (サムネイル)

```
背景: var(--color-surface)
border: 1px solid var(--color-border)
border-radius: var(--radius-xl)
hover: border-color var(--color-accent), shadow var(--shadow-2)
サムネイル高さ: 120px object-fit cover
メタ: var(--fs-xs) var(--color-text-muted)
アクション: icon buttons、hover 時に表示
```

### Toast 通知

```
位置: bottom-right、margin var(--sp-5)
背景: var(--color-panel)
border: 1px solid var(--color-border)
border-radius: var(--radius-lg)
shadow: var(--shadow-3)
成功: left-border 3px solid var(--color-success)
エラー: left-border 3px solid var(--color-danger)
表示時間: 3秒、フェードアウト 280ms
```

### OCR Panel

```
位置: エディタ下部、折りたたみ可能
最小高: 44px (collapsed) / 200px (expanded)
背景: var(--color-surface)
textarea: var(--font-mono) var(--fs-sm) var(--color-text-primary)
実行中: accent カラーのスピナー + "OCR 実行中..." テキスト
```

---

## Icon System

**ライブラリ**: [Lucide React](https://lucide.dev/)
- サイズ: `size={16}` (toolbar) / `size={20}` (header)
- strokeWidth: `1.5` 統一
- カラー: `currentColor` (親要素の color を継承)

### ツールアイコン対応表

| ツール | Lucide アイコン |
|---|---|
| 矢印 | `MoveUpRight` |
| 矩形 | `Square` |
| 楕円 | `Circle` |
| テキスト | `Type` |
| 連番マーカー | `Hash` |
| ぼかし | `Blend` または `ScanLine` |
| 元に戻す | `Undo2` |
| やり直し | `Redo2` |
| コピー | `Copy` |
| 保存 | `Download` |
| OCR | `ScanText` |
| 削除 | `Trash2` |
| 再編集 | `Pencil` |
| パスコピー | `FolderOpen` |

---

## Motion

- ツールボタン切替: `background` のみ transition、`var(--t-fast)`
- パネル展開: `height` ではなく `max-height` または `transform: scaleY()`、`var(--t-normal)`
- Toast 出現: `translateX(100%) → translateX(0)` + `opacity`、`var(--t-normal)`
- オーバーレイ表示: `opacity 0 → 1`、`80ms`（即時感を優先）
- `prefers-reduced-motion` 時: transition を `0ms` に

---

## Screen Layout Summary

### ① 選択オーバーレイ (全画面透明ウィンドウ)
- 全モニタをカバーする透明ウィンドウ
- `rgba(0,0,0,0.55)` マスク + ドラッグ中は選択領域をクリア
- 右上にモニタ選択バッジ（マルチモニタ時）
- 下部中央にヒントテキスト（Esc / Enter）

### ② 注釈エディタ
```
[Header: ファイル名 ─────────────── Copy | Save | OCR]
[Toolbar: ↗ □ ○ T ① ░ | 色 | 幅 | ↺ ↻ ──────── ×]
[                                                    ]
[          キャプチャ画像 (shadow で浮遊)              ]
[                                                    ]
[OCR Panel ▾ ──────────────────────────────────────]
```
