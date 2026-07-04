use tauri::{command, Manager};

/// Runs OCR on the given base64-encoded PNG image using the Codex CLI.
/// Saves the image to a temp file, invokes `codex exec --image <path> "<prompt>"`,
/// and returns the stdout text.
#[command]
pub async fn run_ocr(image_base64: String, app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::process::Command;

    let bytes = STANDARD.decode(&image_base64).map_err(|e| e.to_string())?;

    let temp_dir = app.path().temp_dir().map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join("clipse_ocr_tmp.png");
    std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    let prompt = "この画像に写っている文字を、要約・補完・改変せず、見えているままそのまま書き出してください。";

    let output = Command::new("codex")
        .args(["exec", "--image", &temp_path.to_string_lossy(), prompt])
        .output()
        .map_err(|e| {
            format!(
                "Codex CLI の実行に失敗しました: {}. codex コマンドがインストールされているか確認してください。",
                e
            )
        })?;

    let _ = std::fs::remove_file(&temp_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Codex CLI エラー: {}", stderr));
    }

    let text = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}
