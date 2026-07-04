# Clipse

<img src="src-tauri/icons/128x128.png" width="64" align="right" alt="Clipse icon" />

軽量スクリーンショットツール。ホットキー一発で画面をキャプチャし、注釈を付けてすぐ共有できる Windows 向けデスクトップアプリです。Tauri v2（React + Rust）製、システムトレイ常駐。

## 機能

- 範囲選択（`PrintScreen`）／ウィンドウ／全画面キャプチャ（マルチモニター・混在 DPI 対応）
- スクロールキャプチャ（縦長ページを 1 枚に合成）
- 注釈エディタ（矢印・矩形・テキスト・連番マーカー・ぼかし・ハイライトなど、アンドゥ対応）
- 画面録画（MP4 / GIF）
- OCR（要 [Codex CLI](https://github.com/openai/codex)）
- ギャラリー（履歴の一覧・リネーム・削除・再編集）
- クリップボード連携（自動コピー、画像／ファイルコピー）

## 動作環境

- Windows 10 / 11

## インストール

[Releases](../../releases) からインストーラをダウンロードして実行してください。

- `Clipse_x.y.z_x64-setup.exe`（NSIS、ユーザー単位）
- `Clipse_x.y.z_x64_en-US.msi`（MSI）

## 使い方

| 操作 | 動作 |
|---|---|
| `PrintScreen` | 範囲選択オーバーレイを開く |
| トレイアイコン左クリック | ギャラリーを表示 |
| トレイメニュー | 各種キャプチャ、設定、終了 |

キャプチャ後は自動保存され、注釈エディタが開きます。ウィンドウを閉じてもアプリはトレイに残ります（終了はトレイメニューの Quit）。

## 開発

```bash
# 依存関係のインストール
npm install

# 開発モード（フロント + Rust、ホットリロード）
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

インストーラは `src-tauri/target/release/bundle/` 以下に生成されます。

アーキテクチャの詳細は [CLAUDE.md](CLAUDE.md) を参照してください。

## ライセンス

[MIT](LICENSE)
