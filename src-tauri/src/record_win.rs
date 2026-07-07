//! Windows-only screen recording (MP4 via Media Foundation, GIF via the `gif`
//! crate), built on the `windows-capture` (Windows.Graphics.Capture) crate.
//!
//! A single global recording session is tracked in `SESSION`. `start` launches a
//! free-threaded capture; `stop` halts the capture thread, then finalizes the
//! encoder once no more frames can arrive (robust even for a static screen,
//! which would otherwise deliver no further frames to react to).
//!
//! v1 records the **primary monitor** only (region recording is a later step).

use std::error::Error;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

type BoxErr = Box<dyn Error + Send + Sync>;

/// Hard safety cap so a recording can never run forever if stop is missed.
const MAX_DURATION_SECS: u64 = 600;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RecordMode {
    Mp4,
    Gif,
}

#[derive(Clone)]
pub struct RecordFlags {
    pub mode: RecordMode,
    pub path: PathBuf,
    /// Where to save the first captured frame as a PNG thumbnail (MP4 only).
    pub thumb_path: Option<PathBuf>,
    pub mp4_fps: u32,
    pub gif_fps: u32,
    pub gif_max_width: u32,
    /// 0 = primary monitor; n ≥ 1 = Monitor::from_index(n) (1-based).
    pub monitor_index: usize,
}

/// The capture handler. Lazily creates the encoder on the first frame so its
/// dimensions match the captured frame exactly.
pub struct Recorder {
    flags: RecordFlags,
    encoder: Option<VideoEncoder>,
    gif: Option<gif::Encoder<BufWriter<File>>>,
    start: Instant,
    last_gif: Option<Instant>,
    finished: bool,
    thumb_saved: bool,
}

impl Recorder {
    /// Finishes the MP4 encoder / closes the GIF (idempotent).
    fn finalize(&mut self) -> Result<(), BoxErr> {
        if self.finished {
            return Ok(());
        }
        if let Some(enc) = self.encoder.take() {
            enc.finish()?;
        }
        if let Some(gif) = self.gif.take() {
            drop(gif); // writing the trailer happens on drop
        }
        self.finished = true;
        Ok(())
    }

    fn handle_gif(&mut self, frame: &mut Frame) -> Result<(), BoxErr> {
        // Throttle to the target GIF frame rate.
        let now = Instant::now();
        let interval = Duration::from_millis((1000 / self.flags.gif_fps.max(1)) as u64);
        if let Some(last) = self.last_gif {
            if now.duration_since(last) < interval {
                return Ok(());
            }
        }
        self.last_gif = Some(now);

        let w = frame.width();
        let h = frame.height();
        let mut buf = frame.buffer()?;
        let data = buf.as_nopadding_buffer()?; // tightly-packed RGBA
        let (sw, sh, mut scaled) = downscale_rgba(data, w, h, self.flags.gif_max_width);

        if self.gif.is_none() {
            let file = File::create(&self.flags.path)?;
            let mut enc = gif::Encoder::new(BufWriter::new(file), sw as u16, sh as u16, &[])?;
            enc.set_repeat(gif::Repeat::Infinite)?;
            self.gif = Some(enc);
        }
        // GIF delay is in centiseconds; clamp to >= 2 (browsers floor very small delays).
        let delay = (100 / self.flags.gif_fps.max(1)).max(2) as u16;
        let mut gframe = gif::Frame::from_rgba_speed(sw as u16, sh as u16, &mut scaled, 30);
        gframe.delay = delay;
        gframe.dispose = gif::DisposalMethod::Any;
        if let Some(enc) = self.gif.as_mut() {
            enc.write_frame(&gframe)?;
        }
        Ok(())
    }
}

impl GraphicsCaptureApiHandler for Recorder {
    type Flags = RecordFlags;
    type Error = BoxErr;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            flags: ctx.flags,
            encoder: None,
            gif: None,
            start: Instant::now(),
            last_gif: None,
            finished: false,
            thumb_saved: false,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.start.elapsed().as_secs() >= MAX_DURATION_SECS {
            self.finalize()?;
            capture_control.stop();
            return Ok(());
        }

        // Save the first frame as a PNG thumbnail (best-effort, MP4 only).
        // Only the raw buffer copy happens here — the downscale + PNG encode
        // run on a scratch thread, so they never stall this capture callback
        // (a stall here blocks frame delivery and shows up as a stutter at the
        // start of the recording).
        if !self.thumb_saved {
            self.thumb_saved = true;
            if let Some(tp) = self.flags.thumb_path.clone() {
                let w = frame.width();
                let h = frame.height();
                if let Ok(mut buf) = frame.buffer() {
                    if let Ok(data) = buf.as_nopadding_buffer() {
                        let pixels = data.to_vec();
                        std::thread::spawn(move || {
                            let (tw, th, pixels) = downscale_rgba(&pixels, w, h, 440);
                            if let Some(img) = image::RgbaImage::from_raw(tw, th, pixels) {
                                let _ = img.save(&tp);
                            }
                        });
                    }
                }
            }
        }

        match self.flags.mode {
            RecordMode::Mp4 => {
                if self.encoder.is_none() {
                    let enc = VideoEncoder::new(
                        VideoSettingsBuilder::new(frame.width(), frame.height())
                            .frame_rate(self.flags.mp4_fps),
                        AudioSettingsBuilder::default().disabled(true),
                        ContainerSettingsBuilder::default(),
                        &self.flags.path,
                    )?;
                    self.encoder = Some(enc);
                }
                if let Some(enc) = self.encoder.as_mut() {
                    enc.send_frame(frame)?;
                }
            }
            RecordMode::Gif => self.handle_gif(frame)?,
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.finalize()
    }
}

/// Downscales an RGBA buffer so its width is at most `max_w` (keeps aspect).
fn downscale_rgba(data: &[u8], w: u32, h: u32, max_w: u32) -> (u32, u32, Vec<u8>) {
    if w <= max_w || w == 0 {
        return (w, h, data.to_vec());
    }
    let nh = (h * max_w / w).max(1);
    match image::RgbaImage::from_raw(w, h, data.to_vec()) {
        Some(img) => {
            let resized =
                image::imageops::resize(&img, max_w, nh, image::imageops::FilterType::Triangle);
            (max_w, nh, resized.into_raw())
        }
        None => (w, h, data.to_vec()),
    }
}

// ===== Global session =====

struct Session {
    control: Option<CaptureControl<Recorder, BoxErr>>,
    callback: Arc<parking_lot::Mutex<Recorder>>,
    path: PathBuf,
    format: String,
}

fn session_slot() -> &'static Mutex<Option<Session>> {
    static S: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

pub fn is_recording() -> bool {
    // Recover from a poisoned lock rather than reporting "not recording" — a
    // false negative here makes the PrintScreen hotkey silently skip stopping.
    let slot = session_slot().lock().unwrap_or_else(|p| p.into_inner());
    slot.is_some()
}

/// Starts recording the specified monitor. Errors if already recording.
pub fn start(flags: RecordFlags) -> Result<(), String> {
    let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("Already recording".into());
    }

    let monitor = if flags.monitor_index == 0 {
        Monitor::primary().map_err(|e| e.to_string())?
    } else {
        Monitor::from_index(flags.monitor_index).map_err(|e| e.to_string())?
    };
    let format = match flags.mode {
        RecordMode::Mp4 => "mp4",
        RecordMode::Gif => "gif",
    }
    .to_string();
    let path = flags.path.clone();

    // Throttle frame delivery to the target rate at the WGC level instead of
    // receiving every vsync. `VideoEncoder::send_frame` blocks the capture
    // callback until Media Foundation finishes each frame, so at 60Hz delivery
    // with a 30fps target the encoder gets twice the work and drops frames
    // *irregularly* — which plays back as visible judder. Capping delivery to
    // the encode rate keeps a steady cadence the encoder can sustain. The
    // small subtraction keeps the interval just under an exact vsync multiple
    // so rounding can't skip to the next one (30fps on 60Hz → every 2nd vsync).
    let target_fps = match flags.mode {
        RecordMode::Mp4 => flags.mp4_fps.max(1),
        RecordMode::Gif => flags.gif_fps.max(1),
    };
    let min_interval = Duration::from_micros((1_000_000 / target_fps as u64).saturating_sub(2_000));

    // Some Windows builds/GPU drivers don't support throttling WGC's delivery
    // rate (GraphicsCaptureApi::is_minimum_update_interval_supported() false);
    // requesting Custom there fails the whole capture with
    // MinimumUpdateIntervalUnsupported. Fall back to Default (full vsync-rate
    // delivery) rather than refusing to record at all.
    let interval_settings =
        match windows_capture::graphics_capture_api::GraphicsCaptureApi::is_minimum_update_interval_supported() {
            Ok(true) => MinimumUpdateIntervalSettings::Custom(min_interval),
            _ => MinimumUpdateIntervalSettings::Default,
        };

    let settings = Settings::new(
        monitor,
        CursorCaptureSettings::Default,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        interval_settings,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        flags,
    );

    let control = Recorder::start_free_threaded(settings).map_err(|e| e.to_string())?;
    let callback = control.callback();
    *slot = Some(Session {
        control: Some(control),
        callback,
        path,
        format,
    });
    // Arm the Escape-stops-recording hotkey for the duration of the recording.
    crate::hook_win::enable_stop_hotkey();
    Ok(())
}

/// How long to wait for the capture-thread join + encoder finalize before
/// giving up. Some Media Foundation finalize paths can hang indefinitely; a
/// watchdog keeps a stuck teardown from freezing the recording forever.
const STOP_TIMEOUT_SECS: u64 = 15;

/// Stops the recording, finalizes the file, and returns (path, format).
///
/// The teardown (halt capture thread + finalize encoder) runs on a scratch
/// thread guarded by a timeout: if Media Foundation wedges during finalize we
/// return an error instead of blocking forever, so the session is cleared and
/// the UI can recover (the scratch thread is left to finish or leak).
pub fn stop() -> Result<(PathBuf, String), String> {
    let mut session = {
        let mut slot = session_slot().lock().unwrap_or_else(|p| p.into_inner());
        slot.take().ok_or("Not recording")?
    };

    // Recording is ending — disarm the Escape hotkey so Esc behaves normally again.
    crate::hook_win::disable_stop_hotkey();

    let path = session.path.clone();
    let format = session.format.clone();
    let control = session.control.take();
    let callback = session.callback.clone();

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let res = (|| -> Result<(), String> {
            // Halt the capture thread (posts WM_QUIT and joins) so no more frames arrive.
            if let Some(control) = control {
                control.stop().map_err(|e| e.to_string())?;
            }
            // Then finalize the encoder from this thread.
            let mut rec = callback.lock();
            rec.finalize().map_err(|e| e.to_string())
        })();
        let _ = tx.send(res);
    });

    match rx.recv_timeout(Duration::from_secs(STOP_TIMEOUT_SECS)) {
        Ok(Ok(())) => Ok((path, format)),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!(
            "Recording finalize timed out after {STOP_TIMEOUT_SECS}s"
        )),
    }
}

// ===== One-shot window capture (Windows.Graphics.Capture) =====

/// Grabs a single frame of a window by HWND via Windows.Graphics.Capture. Unlike
/// PrintWindow or a screen read, WGC works for GPU-accelerated apps (Chromium /
/// Electron / DirectX) and is immune to occlusion and monitor boundaries — it
/// captures the window's own composed surface. Used by the window-capture path.
struct WindowShot {
    tx: Option<std::sync::mpsc::Sender<Result<image::RgbaImage, String>>>,
}

impl GraphicsCaptureApiHandler for WindowShot {
    type Flags = std::sync::mpsc::Sender<Result<image::RgbaImage, String>>;
    type Error = BoxErr;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { tx: Some(ctx.flags) })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        // Take the first frame, hand it back, and stop.
        if let Some(tx) = self.tx.take() {
            let res = (|| -> Result<image::RgbaImage, String> {
                let w = frame.width();
                let h = frame.height();
                let mut buf = frame.buffer().map_err(|e| e.to_string())?;
                let data = buf.as_nopadding_buffer().map_err(|e| e.to_string())?; // RGBA
                image::RgbaImage::from_raw(w, h, data.to_vec())
                    .ok_or_else(|| "RgbaImage::from_raw failed".to_string())
            })();
            let _ = tx.send(res);
            capture_control.stop();
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Err("capture closed before a frame arrived".to_string()));
        }
        Ok(())
    }
}

/// Captures a single window's content by HWND. Returns RGBA pixels at the window's
/// physical size. `with_cursor` mirrors the user's "capture cursor" setting —
/// Windows.Graphics.Capture composites the system cursor into the frame itself
/// when enabled, so no separate GDI overlay is needed for this path.
pub fn capture_window(hwnd: *mut std::ffi::c_void, with_cursor: bool) -> Result<image::RgbaImage, String> {
    use windows_capture::window::Window;

    let window = Window::from_raw_hwnd(hwnd);
    if !window.is_valid() {
        return Err("Invalid window handle".to_string());
    }

    let cursor_settings = if with_cursor {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::WithoutCursor
    };

    let (tx, rx) = std::sync::mpsc::channel();
    let settings = Settings::new(
        window,
        cursor_settings,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        tx,
    );

    let control = WindowShot::start_free_threaded(settings).map_err(|e| e.to_string())?;
    let result = rx
        .recv_timeout(Duration::from_millis(2000))
        .map_err(|_| "Window capture timed out".to_string());
    let _ = control.stop();
    result?
}
