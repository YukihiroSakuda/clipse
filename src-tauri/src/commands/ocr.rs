use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{command, Manager};

/// The instruction both engines get. Deliberately negative ("without
/// summarizing, completing, or altering") — a model handed a screenshot will
/// otherwise happily describe or fix the text instead of transcribing it.
const PROMPT: &str = "Transcribe exactly the text visible in this image, as-is, without summarizing, completing, or altering it.";

/// Sentinel `run_ocr` returns when `ocr.consented` is false. Matched verbatim by
/// the frontend (`src/lib/ipc.ts`), which turns it into the consent dialog and
/// retries once granted — so it must stay a stable, distinctive string rather
/// than prose that could be reworded. Not shown to the user as-is.
pub const CONSENT_REQUIRED: &str = "OCR_CONSENT_REQUIRED";

/// Records the user's answer to the OCR consent dialog and persists it.
///
/// A dedicated command rather than a `save_settings` round-trip because the
/// asker is an editor window, which doesn't hold the settings document — having
/// it read, mutate and write back the whole thing would let a stale copy from
/// before some other window's edit clobber unrelated settings.
#[command]
pub async fn set_ocr_consent(granted: bool, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::state::AppState>();
    let updated = {
        let mut guard = state.settings.lock().map_err(|_| "settings lock poisoned")?;
        guard.ocr.consented = granted;
        guard.clone()
    };
    crate::settings::persist(&app, &updated)
}

/// The external CLI that does the reading. Clipse bundles no OCR engine; it
/// shells out to an agentic coding CLI the user already has installed, which
/// beats a classic OCR engine on screenshots (mixed fonts, UI chrome, code).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Engine {
    /// `codex exec --image <path> <prompt>` — takes the image as a flag.
    Codex,
    /// `claude -p <prompt>` — Claude Code has **no image flag**, so the image
    /// is handed over by path in the prompt and read with the `Read` tool
    /// (allowlisted below, and the working directory is set to the image's own
    /// folder so no `--add-dir` grant is needed).
    Claude,
}

impl Engine {
    fn program(self) -> &'static str {
        match self {
            Engine::Codex => "codex",
            Engine::Claude => "claude",
        }
    }
}

/// Resolves a CLI name to an executable path by walking `PATH`.
///
/// Not just politeness on Windows: `std::process::Command` resolves a bare name
/// by appending `.exe` only — it never consults `PATHEXT`. Both of these CLIs
/// are commonly npm-installed, which ships `claude.cmd` / `codex.cmd` and no
/// `.exe` at all, so `Command::new("claude")` fails with "program not found" on
/// a machine where `claude` works fine in any shell. Resolving to the full
/// `.cmd` path fixes it: since Rust 1.77 `Command` runs a `.cmd`/`.bat` target
/// through `cmd.exe` itself, with correct argument escaping.
fn resolve(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;

    #[cfg(target_os = "windows")]
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(|e| e.to_ascii_lowercase())
        .collect();
    #[cfg(not(target_os = "windows"))]
    let exts: Vec<String> = vec![String::new()];

    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{program}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Picks the engine to run from the `ocr.engine` setting, resolving it to a
/// real executable. "auto" tries Codex first, so installs that predate Claude
/// Code support keep the engine they were already using.
fn pick(preference: &str) -> Result<(Engine, PathBuf), String> {
    let candidates: &[Engine] = match preference {
        "codex" => &[Engine::Codex],
        "claude" => &[Engine::Claude],
        _ => &[Engine::Codex, Engine::Claude],
    };

    for &engine in candidates {
        if let Some(path) = resolve(engine.program()) {
            return Ok((engine, path));
        }
    }

    // The restart note is the one piece of this the CLIs' own docs can never
    // carry: Clipse is resident, and a process keeps the environment it was
    // started with, so installing a CLI while the tray icon is running leaves
    // it invisible here until the app is restarted.
    const RESTART: &str =
        "If you just installed it, restart Clipse — a running app keeps the PATH it started with.";

    Err(match candidates {
        [only] => format!(
            "The `{}` command was not found on PATH. Install it, or pick a different OCR engine in Settings. {RESTART}",
            only.program()
        ),
        _ => format!(
            "No OCR engine found. Install the Claude Code CLI (`claude`) or the Codex CLI (`codex`) and make sure it is on PATH. {RESTART}"
        ),
    })
}

/// Runs OCR on the given base64-encoded PNG image by shelling out to the
/// configured CLI, and returns its stdout text.
///
/// The child process is spawned on a blocking thread: an agentic CLI takes
/// seconds to tens of seconds to answer, and blocking an async-runtime worker
/// for that long stalls unrelated work (capture paths run on those threads).
#[command]
pub async fn run_ocr(image_base64: String, app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let settings = crate::settings::current(&app);

    // Checked before the image is decoded, written to disk, or handed to
    // anything: OCR is the only path in Clipse that sends capture content off
    // the machine, so consent is enforced at the point of transmission rather
    // than trusted to the caller. The frontend asks and then retries, but a
    // window that skipped the dialog gets refused here rather than leaking.
    if !settings.ocr.consented {
        return Err(CONSENT_REQUIRED.to_string());
    }

    let bytes = STANDARD.decode(&image_base64).map_err(|e| e.to_string())?;

    let (engine, exe) = pick(&settings.ocr.engine)?;

    // Own subdirectory rather than the temp root: it becomes the child's
    // working directory, and pointing an agentic CLI at all of %TEMP% makes it
    // scan a directory full of unrelated junk for project context.
    let dir = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("clipse-ocr");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Unique per call — a fixed name let two editors running OCR at once
    // overwrite each other's image, and each run is now long enough to overlap.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let name = format!(
        "ocr-{}-{}.png",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let image_path = dir.join(&name);
    std::fs::write(&image_path, &bytes).map_err(|e| e.to_string())?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&exe);
        match engine {
            Engine::Codex => {
                cmd.args(["exec", "--image", &image_path.to_string_lossy(), PROMPT]);
            }
            Engine::Claude => {
                cmd.args([
                    "-p",
                    // Without the allowlist the Read call needs an interactive
                    // approval that `-p` can never collect, and the run fails.
                    "--allowedTools",
                    "Read",
                    "--output-format",
                    "text",
                    &format!(
                        "Read the image file {name} in the current directory. {PROMPT} \
                         Output only the transcribed text, with no preamble or commentary."
                    ),
                ]);
            }
        }
        cmd.current_dir(&dir)
            // Null, not inherited: a CLI that reads stdin for extra input would
            // otherwise wait forever on a handle nothing is ever going to write.
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Clipse is a GUI app with no console, so spawning a `.cmd` (i.e.
        // cmd.exe) pops a console window on screen for the whole run.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output();
        let _ = std::fs::remove_file(&image_path);
        output
    })
    .await
    .map_err(|e| e.to_string())?;

    let output = result.map_err(|e| {
        format!(
            "Failed to run the {} CLI: {}",
            engine.program(),
            e
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        let detail = if detail.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else {
            detail.to_string()
        };
        crate::diag::log(&format!(
            "ocr: {} exited with {}",
            engine.program(),
            output.status
        ));
        return Err(format!("{} CLI error: {}", engine.program(), detail));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(text)
}
