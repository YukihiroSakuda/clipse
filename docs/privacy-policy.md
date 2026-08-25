# Clipse Privacy Policy

**Last updated: 2026-08-26**

Clipse is a screenshot capture and annotation tool for Windows, published by Yukihiro Sakuda.

This document describes exactly what Clipse does with your data. The short version: **everything stays on your device except OCR, which you must explicitly turn on, and the update check.**

---

## 1. What Clipse stores on your device

| Data | Where | Notes |
|---|---|---|
| Captured images and recordings | The folder set in Settings → Saving, or the app data folder by default | Never uploaded anywhere by Clipse |
| Annotation sidecar files | Next to the saved capture | Contain your annotations, including any picture you paste into the editor |
| `settings.json` | App data folder | Your preferences, including the OCR consent flag |
| `clipse.log` | App data folder | Diagnostics — see section 4 |
| Cached thumbnails | App data folder | For the gallery view |

Clipse has no account, no sign-in, and no server of its own. None of the above is transmitted anywhere by Clipse.

## 2. The system clipboard

Every capture is copied to the Windows clipboard so you can paste it immediately. This is a local OS facility; Clipse does not send clipboard content anywhere. Note that other software on your machine, or Windows features such as Clipboard History and cross-device sync, may process clipboard content according to their own policies.

## 3. OCR — the one feature that sends your image off the device

Clipse bundles no OCR engine. When you use OCR, Clipse writes the image to a temporary folder and runs an external AI command-line tool that you have installed separately — the Claude Code CLI (Anthropic) or the Codex CLI (OpenAI). **That tool sends the image to its provider to be read.**

- **OCR is off until you agree.** The first time you run it, Clipse asks, and refuses to proceed until you accept. Existing installations upgrading to this version are asked the same question — no prior consent is assumed.
- **You can withdraw at any time** in Settings → OCR, which disables the feature again.
- **The image is handled by that provider under their terms and privacy policy**, not this one. Please read [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) or [OpenAI's privacy policy](https://openai.com/policies/privacy-policy) depending on which tool you use.
- Clipse does not send anything to Anthropic or OpenAI itself, and has no API key or account with either. It runs the CLI you already installed and signed in to.
- The temporary image file is written to `%TEMP%\clipse-ocr`.

If you never turn OCR on, no capture content ever leaves your device through Clipse.

## 4. Diagnostics (`clipse.log`)

Clipse writes a small local log to help diagnose capture problems, capped at about 2 MB total.

**It records only geometry and code-path decisions** — monitor counts and rectangles, which capture path was taken, timings, and error codes.

**It deliberately never records** window titles, image data, text you type, keystrokes, file contents, file paths of your captures, or any personal identifier.

The log stays on your device. It is only shared if you choose to send it when reporting a problem.

## 5. Global keyboard shortcut

Clipse installs a Windows low-level keyboard hook so the PrintScreen key can open the capture overlay even when another application has focus. The hook inspects each keystroke **only** to test it against your two configured shortcuts, and claims a keystroke only on an exact match. **Keystrokes are never recorded, stored, or transmitted.**

## 6. Update check

Clipse checks for new versions by requesting a small version file from its public GitHub release page. This sends nothing but the ordinary information any web request carries (such as your IP address, which GitHub receives as the host). No identifier, usage data, or capture content is included.

## 7. Analytics

There are none. Clipse contains no analytics, telemetry, crash reporting, advertising, or tracking of any kind.

## 8. Children

Clipse is a general-purpose utility and is not directed at children. It does not knowingly collect personal information from anyone.

## 9. Changes

Material changes to this policy will be published here, with the "Last updated" date revised.

## 10. Contact

Questions about this policy: <yukihirosakuda@gmail.com>

---
---

# Clipse プライバシーポリシー

**最終更新日: 2026年8月26日**

Clipse は Windows 向けのスクリーンショット撮影・注釈ツールです。発行者は Yukihiro Sakuda です。

本ポリシーは、Clipse がお客様のデータをどのように扱うかを記載したものです。要点は次のとおりです。**明示的に有効化した場合の OCR と、更新確認を除き、すべてのデータはお客様の端末内にとどまります。**

---

## 1. 端末内に保存されるもの

| データ | 保存場所 | 備考 |
|---|---|---|
| キャプチャ画像・録画 | 設定 →「保存」で指定したフォルダ（既定はアプリデータフォルダ） | Clipse がどこかへ送信することはありません |
| 注釈のサイドカーファイル | 保存したキャプチャと同じ場所 | 貼り付けた画像を含む注釈内容 |
| `settings.json` | アプリデータフォルダ | OCR の同意状態を含む各種設定 |
| `clipse.log` | アプリデータフォルダ | 診断情報（第4項参照） |
| サムネイルキャッシュ | アプリデータフォルダ | ギャラリー表示用 |

Clipse にはアカウント機能もサインインも独自サーバーもありません。上記のいずれも Clipse が外部へ送信することはありません。

## 2. システムクリップボード

すぐに貼り付けられるよう、キャプチャは毎回 Windows のクリップボードへコピーされます。これは OS のローカル機能であり、Clipse がクリップボードの内容を外部へ送信することはありません。ただし、端末内の他のソフトウェアや、Windows のクリップボード履歴・デバイス間同期などの機能が、それぞれのポリシーに従って内容を処理する場合があります。

## 3. OCR — 唯一、画像が端末外へ送信される機能

Clipse は OCR エンジンを同梱していません。OCR を実行すると、Clipse は画像を一時フォルダへ書き出し、お客様が別途インストールした外部の AI コマンドラインツール（Anthropic の Claude Code CLI、または OpenAI の Codex CLI）を起動します。**そのツールが、読み取りのため画像を提供元へ送信します。**

- **同意するまで OCR は無効です。** 初回実行時に確認ダイアログを表示し、承諾されるまで処理を行いません。本バージョンへ更新した既存のインストールでも同じ確認を行います。過去の同意を推定することはありません。
- **同意はいつでも取り消せます**（設定 → OCR）。取り消すと機能は再び無効になります。
- **画像は当該提供元の利用規約およびプライバシーポリシーに従って扱われます。**本ポリシーの対象ではありません。ご利用のツールに応じて [Anthropic のプライバシーポリシー](https://www.anthropic.com/legal/privacy) または [OpenAI のプライバシーポリシー](https://openai.com/policies/privacy-policy) をご確認ください。
- Clipse 自身が Anthropic や OpenAI へ送信することはなく、いずれの API キーもアカウントも保持しません。お客様がインストール済みかつサインイン済みの CLI を起動するのみです。
- 一時画像ファイルの書き出し先は `%TEMP%\clipse-ocr` です。

OCR を有効化しない限り、キャプチャ内容が Clipse を通じて端末外へ出ることはありません。

## 4. 診断ログ（`clipse.log`）

キャプチャの不具合を調査するため、端末内に小さなログを記録します（合計約 2MB を上限にローテーションします）。

**記録するのは座標情報とコードパスの判断のみ**です。モニター数と矩形、どのキャプチャ経路を通ったか、所要時間、エラーコードなどが該当します。

**記録しないもの**：ウィンドウタイトル、画像データ、入力した文字列、キーストローク、ファイルの内容、キャプチャのファイルパス、その他の個人識別情報。

ログは端末内にとどまります。不具合報告の際にお客様自身が送信を選択した場合にのみ共有されます。

## 5. グローバルキーボードショートカット

他のアプリケーションが前面にある状態でも PrintScreen キーでキャプチャ用オーバーレイを開けるよう、Clipse は Windows の低レベルキーボードフックを使用します。フックが各キーストロークを参照するのは、設定された2つのショートカットと照合するため**のみ**であり、完全に一致した場合にのみそのキーを処理します。**キーストロークの記録・保存・送信は一切行いません。**

## 6. 更新確認

Clipse は、公開されている GitHub のリリースページから小さなバージョン情報ファイルを取得して更新を確認します。この通信に含まれるのは、通常の Web リクエストに伴う情報（ホストである GitHub が受け取る IP アドレスなど）のみです。識別子・利用状況・キャプチャ内容は一切含まれません。

## 7. 解析・計測

ありません。Clipse には解析、テレメトリ、クラッシュレポート、広告、トラッキングの類は一切含まれていません。

## 8. 児童について

Clipse は汎用のユーティリティであり、児童を対象としたものではありません。何人からも意図的に個人情報を収集することはありません。

## 9. 変更

本ポリシーの重要な変更は本ページで公開し、「最終更新日」を改訂します。

## 10. お問い合わせ

本ポリシーに関するお問い合わせ: <yukihirosakuda@gmail.com>
