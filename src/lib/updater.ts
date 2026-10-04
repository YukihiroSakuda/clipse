// Self-update against the GitHub Releases feed configured in `tauri.conf.json`.
//
// This exists because of how Clipse reaches the Microsoft Store. Tauri cannot
// produce MSIX, so the Store listing links to the NSIS installer rather than
// hosting a package — which means Microsoft never pushes updates for us the way
// it does for MSIX apps. The app has to update itself, or a Store install stays
// on whatever version it was first downloaded at forever.
//
// Every payload is verified against the public key in `tauri.conf.json` before
// it is run; an artifact that isn't signed by the matching private key is
// rejected by the plugin, so a compromised release host cannot push code here.

import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; update: Update }
  | { status: 'downloading'; percent: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }

/** Looks for a newer release. Returns null when already current. */
export async function checkForUpdate(): Promise<Update | null> {
  return await check()
}

/**
 * Downloads, verifies and installs `update`, reporting 0–100 progress.
 *
 * `contentLength` is absent on some responses, so progress is only reported
 * when a total is actually known — a bar that jumps to 100% and sits there is
 * worse than no bar. The caller relaunches; this does not, so it can be used
 * from a window that wants to warn the user first.
 */
export async function installUpdate(
  update: Update,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let total = 0
  let received = 0
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0
        break
      case 'Progress':
        received += event.data.chunkLength
        if (total > 0) onProgress?.(Math.min(100, Math.round((received / total) * 100)))
        break
      case 'Finished':
        onProgress?.(100)
        break
    }
  })
}

/** Restarts into the newly installed version. */
export async function restartIntoUpdate(): Promise<void> {
  await relaunch()
}
