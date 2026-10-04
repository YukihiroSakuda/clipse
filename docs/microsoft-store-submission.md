# Microsoft Store submission checklist

Clipse ships to the Store as a **linked EXE installer**, not an MSIX — Tauri cannot produce MSIX, and Clipse's core mechanisms (a low-level keyboard hook, DXGI Desktop Duplication, launching an external CLI, registry autostart) assume full-trust Win32 rather than an MSIX container. See CLAUDE.md § Distribution and self-update.

## Done in the repo

- [x] `bundle.publisher` no longer equals `productName` (a Store requirement)
- [x] `src-tauri/tauri.microsoftstore.conf.json` — `webviewInstallMode: skip`, which keeps the installer at **4.6MB** while still downloading nothing during setup (see below)
- [x] NSIS supports silent install (`/S`) — required for Win32 Store apps
- [x] OCR gated behind explicit, withdrawable consent, enforced in the backend
- [x] `docs/privacy-policy.md` — bilingual, matches what the code actually does
- [x] Self-update wired up (`src/lib/updater.ts`), since Microsoft does not update linked installers
- [x] `.github/workflows/release.yml` — publishes a **draft** release with versioned, immutable asset URLs

## Still to do — these need your account, your money, or your decision

### 1. Code signing certificate
The linked installer must be signed. **Azure Trusted Signing** is the cheapest current route (monthly, no hardware token); a traditional OV/EV certificate is the alternative. Without this, SmartScreen will warn on every download and certification is at risk.

Once obtained, add the signing step to `release.yml` before the upload step.

### 2. Partner Center
- [ ] Register an individual developer account (one-time fee — verify the current amount)
- [ ] Reserve the app name **Clipse**
- [ ] Set the product type to **EXE/MSI app**

### 3. Repo secrets for CI
- [ ] `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.clipse/updater.key`
- [ ] `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty string as generated; set a real password if you regenerate

> **Back up `~/.clipse/updater.key` somewhere safe and private.** Lose it and no existing install can ever be updated again. Leak it and anyone can ship code that every install will accept and run. It was generated without a password for unattended CI builds — regenerate it with one if you prefer, which is free to do until the first release ships.

### 4. Host the privacy policy
Partner Center requires a public URL. Either works:
- GitHub Pages over `docs/`
- The rendered file: `https://github.com/YukihiroSakuda/clipse/blob/main/docs/privacy-policy.md`

### 5. Submission form
- [ ] **Minimum OS version: Windows 11** — required, see "Why the Store build skips WebView2" below
- [ ] Privacy policy URL (above)
- [ ] Installer URL — the **versioned** GitHub Release asset (`Clipse_x.y.z_x64-store-setup.exe`). The binary behind it must never change; ship a new version instead.
- [ ] Age rating questionnaire
- [ ] Store listing: screenshots, description, category (Utilities)
- [ ] **Declare the OCR data flow** where the form asks about data collection: captured images are sent to Anthropic or OpenAI, only after in-app consent

### 6. Review notes — write these proactively
Two things in Clipse look alarming to an automated scan, and explaining them up front is cheaper than a rejection:

- **The low-level keyboard hook.** Clipse installs `WH_KEYBOARD_LL` so PrintScreen works while another app has focus. Say plainly that keystrokes are never recorded, stored, or transmitted, that the hook only compares each key against the user's two configured shortcuts, and that it claims a key only on an exact match. Point at `src-tauri/src/hook_win.rs`.
- **OCR launching an external CLI.** Clipse bundles no OCR engine; it runs a CLI the user installed and signed in to themselves. Clipse never downloads or installs software. It is opt-in, disclosed in the dialog and the privacy policy, and withdrawable in Settings.

## Why the Store build skips WebView2

The Store forbids an installer that **downloads bits while it runs**. Tauri's own Store guidance reads that as "embed the WebView2 offline installer", and doing so is what took the installer to **211MB** — about 206MB of which was the runtime, for a 4.6MB app.

But the rule is about downloading *during setup*, not about carrying the runtime. `webviewInstallMode: skip` downloads nothing during setup either, and stays at 4.6MB. The cost is that WebView2 must already be present:

- **Windows 11** — the Evergreen runtime ships as part of the OS. Guaranteed.
- **Windows 10** — pushed to eligible devices and present on the vast majority, but *a small number lack it*, and there the app simply fails to launch.

So the Store listing must set **minimum OS = Windows 11**, which removes that case entirely rather than leaving a minority with a silent startup failure.

**No user is dropped by this.** Windows 10 users still get Clipse from GitHub, where the default build uses `downloadBootstrapper` and installs the runtime if it is missing. Only the Store channel is restricted — and Windows 10 has been out of support since 14 October 2025.

Reverting is a one-line change to `tauri.microsoftstore.conf.json` (`skip` → `offlineInstaller`) if you ever need Windows 10 covered through the Store specifically.

## Release procedure

```bash
# 1. Bump the version in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
# 2. Tag and push — the workflow builds both installers and drafts a release
git tag v0.7.5 && git push origin v0.7.5
# 3. Publish the draft on GitHub
# 4. Point the Partner Center submission at the new versioned URL
```

Local Store build, for checking the artifact before tagging:

```bash
TAURI_SIGNING_PRIVATE_KEY=~/.clipse/updater.key \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
npm run build:store
```

Two traps worth knowing:

- The key goes in **`TAURI_SIGNING_PRIVATE_KEY`** — either the key text or a path to it. `TAURI_SIGNING_PRIVATE_KEY_PATH` is named in the `signer generate` output but is **not** read by `tauri build` here; the bundle is produced and then signing fails with *"A public key has been found, but no private key"*.
- **`npm run` reports exit code 0 even when `tauri build` fails.** Both failures above surfaced only in the output text. Read the tail of the log before believing a build succeeded — in CI, invoke the Tauri CLI directly rather than through an npm script.
