; Clipse is tray-resident (see CLAUDE.md "Tray residency") — it is normally
; still running whenever the user uninstalls it, since the only way to quit
; is the tray menu. Tauri's generated uninstaller already refuses to delete
; a running exe (CheckIfAppIsRunning, right after this hook runs), but that
; path pops a "close the running app?" confirmation and, if the user
; dismisses it or the kill races with something else, aborts the uninstall
; entirely — which reads as an uninstall error for what is, for this app,
; the default state.
;
; Killing the process here, before that check runs, means FindProcess finds
; nothing and the whole prompt/abort path is skipped — uninstall proceeds
; silently instead of depending on the user answering a dialog correctly.
!macro NSIS_HOOK_PREUNINSTALL
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
  !else
    nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
  !endif
  Pop $0
  Sleep 500
!macroend
