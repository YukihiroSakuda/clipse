//! "Launch on system startup", for both ways Clipse is distributed.
//!
//! The NSIS/MSI build writes `HKCU\...\CurrentVersion\Run` through
//! `tauri-plugin-autostart`. That is the right mechanism there and the wrong one
//! inside an MSIX package: registry writes from a packaged app are redirected
//! into the package's private hive, so the value is written successfully, reads
//! back successfully, and Windows never looks at it — the setting would appear
//! to work and simply do nothing.
//!
//! MSIX has its own mechanism: a `windows.startupTask` extension declared in the
//! manifest, toggled at runtime through the `StartupTask` WinRT API. The user can
//! also disable it from Task Manager's Startup tab, and that decision outranks
//! ours — `DisabledByUser` cannot be undone programmatically, only by the user.
//!
//! One binary ships both ways, so which mechanism applies is decided at runtime
//! by `is_packaged()` rather than at compile time.

/// TaskId of the `<desktop:StartupTask>` entry in `AppxManifest.xml`. The two
/// must match exactly or `StartupTask::GetAsync` fails at runtime.
pub const STARTUP_TASK_ID: &str = "ClipseStartupTask";

/// Whether this process is running from an MSIX package.
///
/// `GetCurrentPackageFullName` returns `APPMODEL_ERROR_NO_PACKAGE` (15700) when
/// it isn't; anything else means it is. Cheap enough to call directly, but it
/// can't change during the process's life, so it's resolved once.
pub fn is_packaged() -> bool {
    use std::sync::OnceLock;
    static PACKAGED: OnceLock<bool> = OnceLock::new();
    *PACKAGED.get_or_init(|| {
        use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
        const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
        unsafe {
            let mut len: u32 = 0;
            // Deliberately called with a null buffer: with no package this
            // returns NO_PACKAGE, and with one it returns INSUFFICIENT_BUFFER
            // after setting `len`. Either way it never writes anything.
            let rc = GetCurrentPackageFullName(&mut len, windows::core::PWSTR::null());
            rc.0 != APPMODEL_ERROR_NO_PACKAGE
        }
    })
}

/// State of the packaged startup task. `DisabledByUser` and `DisabledByPolicy`
/// are the two we cannot change from here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupState {
    Enabled,
    Disabled,
    /// Switched off in Task Manager's Startup tab. `RequestEnableAsync` will
    /// return without enabling, and that is the documented behaviour — the
    /// user's choice wins.
    DisabledByUser,
    DisabledByPolicy,
}

fn task() -> windows::core::Result<windows::ApplicationModel::StartupTask> {
    use windows::ApplicationModel::StartupTask;
    let id = windows::core::HSTRING::from(STARTUP_TASK_ID);
    StartupTask::GetAsync(&id)?.get()
}

/// Reads the startup task's current state. `None` when unpackaged or on any
/// failure, which callers treat as "this mechanism doesn't apply here".
pub fn state() -> Option<StartupState> {
    use windows::ApplicationModel::StartupTaskState;
    if !is_packaged() {
        return None;
    }
    let s = task().ok()?.State().ok()?;
    Some(match s {
        StartupTaskState::Enabled => StartupState::Enabled,
        StartupTaskState::DisabledByUser => StartupState::DisabledByUser,
        StartupTaskState::DisabledByPolicy => StartupState::DisabledByPolicy,
        _ => StartupState::Disabled,
    })
}

/// Turns the packaged startup task on or off.
///
/// Returns whether the request took effect. `false` (with a log line) when the
/// user has disabled it in Task Manager: the API succeeds but leaves the task
/// off, and silently reporting success would leave the settings toggle claiming
/// something untrue.
pub fn set_enabled(enable: bool) -> bool {
    if !is_packaged() {
        return false;
    }
    let Ok(t) = task() else {
        crate::diag::log("startup: StartupTask unavailable — is it declared in the manifest?");
        return false;
    };
    if enable {
        if t.RequestEnableAsync().and_then(|op| op.get()).is_err() {
            crate::diag::log("startup: RequestEnableAsync failed");
            return false;
        }
    } else if t.Disable().is_err() {
        crate::diag::log("startup: Disable failed");
        return false;
    }
    let now = state();
    let ok = now == Some(if enable { StartupState::Enabled } else { StartupState::Disabled });
    if !ok {
        crate::diag::log(&format!(
            "startup: requested enable={enable} but state is {now:?} \
             (Task Manager's Startup tab overrides this)"
        ));
    }
    ok
}
