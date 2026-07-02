# Clipse

<img src="src-tauri/icons/128x128.png" width="64" align="right" alt="Clipse icon" />

軽量スクリーンショット支援ツール。ホットキー一発で画面をキャプチャし、矢印・テキストなどの注釈を付けてすぐ共有できる Windows 向けデスクトップアプリです。Tauri v2（React + Rust）製で、システムトレイに常駐します。

## 主な機能

- **キャプチャ** — 範囲選択（`PrintScreen`）／ウィンドウ／モニター全体。マルチモニター・混在 DPI 環境に対応し、DXGI Desktop Duplication によりネイティブ解像度（物理ピクセル）でキャプチャ
- **スクロールキャプチャ** — 縦に長いページを自動スクロールしながら 1 枚に合成
- **注釈エディタ** — 矢印・直線・矩形・楕円・テキスト・連番マーカー・ぼかし・ハイライト・スポットライト。アンドゥ対応
- **画面録画** — MP4 / GIF 形式でのモニター録画（外部ツール不要）
- **OCR** — 画像内のテキストを抽出（[Codex CLI](https://github.com/openai/codex) が必要）
- **ギャラリー** — キャプチャ履歴の一覧・リネーム・削除・再編集
- **クリップボード連携** — キャプチャ後の自動コピー、画像／ファイルとしてのコピー
- **設定** — 保存先フォルダ、ファイル名パターン、出力形式（PNG/JPEG）、カーソル表示、スタートアップ起動、言語（日本語／英語）など

## 動作環境

- Windows 10 / 11（キャプチャ処理は Windows 専用実装）
- OCR 機能を使う場合のみ: `codex` CLI がインストール済みで PATH に通っていること

## インストール

[Releases](../../releases) またはビルド成果物のインストーラを実行してください。

- NSIS: `Clipse_x.y.z_x64-setup.exe`（ユーザー単位インストール）
- MSI: `Clipse_x.y.z_x64_en-US.msi`

インストール後はシステムトレイに常駐します（メインウィンドウは非表示で起動）。

## 使い方

| 操作 | 動作 |
|---|---|
| `PrintScreen` | 範囲選択オーバーレイを開く（Windows 標準の Snipping Tool は抑止されます） |
| トレイアイコン左クリック | ギャラリーを表示 |
| トレイメニュー | 範囲／ウィンドウ／全画面キャプチャ、設定、終了 |

キャプチャ後は自動保存され、注釈エディタが開きます。ウィンドウを閉じてもアプリは終了せずトレイに残ります（終了はトレイメニューの Quit から）。

## 開発

```bash
# 依存関係のインストール
npm install

# フロントエンドのみの dev サーバー
npm run dev

# Tauri 開発モード（フロント + Rust、ホットリロード）
npm run tauri dev

# 型チェック
npx tsc --noEmit

# Rust チェック
cd src-tauri && cargo check
```

## ビルド

```bash
npm run tauri build
```

インストーラは `src-tauri/target/release/bundle/` 以下（`nsis/`, `msi/`）に生成されます。

> **Note**: アイコン（`src-tauri/icons/`）を差し替えた場合、Cargo のキャッシュにより exe への埋め込みが更新されないことがあります。その場合は `cd src-tauri && cargo clean -p clipse --release` してから再ビルドしてください。アイコンの元データは `src-tauri/icons/source/icon.svg` です。

## アーキテクチャ

マルチウィンドウ構成（ギャラリー／モニターごとの透明オーバーレイ／注釈エディタ／設定）で、ウィンドウは Rust 側から動的に生成されます。フロントエンドと Rust 間の IPC は `src/lib/ipc.ts` に型付きラッパーとして集約されています。

```
src/                  — React フロントエンド
  routes/             — Gallery / Overlay / Editor / Recorder / Settings
  lib/                — ipc.ts(IPC), store.ts(Zustand), annotations.ts(注釈定義)
src-tauri/src/
  lib.rs              — Tauri セットアップ、ホットキー、トレイ
  capture_win.rs      — DXGI Desktop Duplication キャプチャ
  hook_win.rs         — PrintScreen 用低レベルキーボードフック
  commands/           — capture / record / storage / clipboard / ocr
```

詳細な設計メモ・制約は [CLAUDE.md](CLAUDE.md) を参照してください。
