//! Dragging saved captures out of the gallery as real files.
//!
//! The gallery could already put a capture on the clipboard; this is the other
//! half of that — dropping the file straight into Explorer, a mail composer or
//! a chat window. A file drop is an OLE drag-and-drop operation carrying a
//! CF_HDROP data object, and that is something a webview cannot start on its
//! own: an HTML5 drag payload is text, and WebView2 exposes no way to hand a
//! drop target a file. So the *gesture* is detected in the frontend and the
//! drag itself runs natively here.
//!
//! Three Windows details shape the implementation:
//!
//! - **The data object comes from the shell, not from us**, so it carries what
//!   Explorer carries: CF_HDROP for plain targets, plus FileContents,
//!   FileGroupDescriptorW and Shell IDList Array for the ones that prefer
//!   those. It is bound off an `IShellItemArray` — see `run_drag` for why the
//!   obvious `SHCreateDataObject` call is the wrong one.
//! - **`DoDragDrop` is modal and thread-bound.** It captures the mouse and runs
//!   its own message loop until the button comes up, and it belongs on the
//!   thread owning the source window. So the whole operation is dispatched to
//!   the main thread and holds it for as long as the user is dragging. That is
//!   what a drag *is* (Explorer blocks its own UI thread the same way), and it
//!   isn't visible here — the gallery has nothing to do meanwhile and WebView2
//!   paints out of process. It does mean nothing else main-thread-bound can make
//!   progress during a drag, which is why this is the only thing on that thread.
//! - **Only `DROPEFFECT_COPY` is offered.** A target allowed to ask for MOVE
//!   would delete the capture out of the gallery on a successful drop, with no
//!   undo; dragging a screenshot into a chat window must never be able to empty
//!   the history.

use tauri::command;

/// Longest edge of the picture shown under the cursor during the drag. Small on
/// purpose — it is a cursor decoration, and the shell renders it unscaled.
#[cfg(target_os = "windows")]
const DRAG_IMAGE_MAX: u32 = 128;

/// Opacity applied to that picture, for the translucent look Explorer uses for
/// dragged files.
#[cfg(target_os = "windows")]
const DRAG_IMAGE_ALPHA: u32 = 200;

/// Starts a native file drag carrying `paths`. Resolves once the user drops or
/// cancels: the OS drag is modal, so there is nothing to report before that.
#[cfg(target_os = "windows")]
#[command]
pub async fn start_file_drag(paths: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no files to drag".into());
    }
    // First of the three stages a "drag does nothing" report is triaged by:
    // this line missing means the gesture never reached the backend at all.
    crate::diag::log("drag: starting");

    // Decoded here rather than inside the main-thread closure: this is file I/O
    // plus a PNG decode, and every millisecond of it is a millisecond the drag
    // hasn't started while the user is already moving the mouse.
    let image = drag_image(&app, &paths[0]);

    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(unsafe { run_drag(&paths, image) });
    })
    .map_err(|e| e.to_string())?;

    // The drag owns the main thread until the user lets go, so the wait for it
    // goes on a blocking thread instead of parking an async-runtime worker —
    // those are the threads the capture paths run on.
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_else(|e| Err(e.to_string())))
        .await
        .map_err(|e| e.to_string())?
}

/// Premultiplied RGBA pixels of the drag image, with its dimensions. `None` when
/// there is no thumbnail to build one from — a drag with only the drop cursor is
/// plainer, not broken.
#[cfg(target_os = "windows")]
fn drag_image(app: &tauri::AppHandle, path: &str) -> Option<(Vec<u8>, u32, u32)> {
    // The gallery's own cached thumbnail: already on disk and already small.
    // Decoding the full-size capture here would cost more than the start of a
    // drag can afford, and a video has no full-size image to decode at all.
    let thumb = super::storage::cached_thumb_path(app, std::path::Path::new(path))?;
    let img = image::open(thumb).ok()?;
    let mut rgba = img.thumbnail(DRAG_IMAGE_MAX, DRAG_IMAGE_MAX).to_rgba8();

    // The shell blends the bitmap over whatever is behind it, so the pixels have
    // to arrive premultiplied by the alpha they claim.
    for px in rgba.pixels_mut() {
        let a = px.0[3] as u32 * DRAG_IMAGE_ALPHA / 255;
        px.0 = [
            (px.0[0] as u32 * a / 255) as u8,
            (px.0[1] as u32 * a / 255) as u8,
            (px.0[2] as u32 * a / 255) as u8,
            a as u8,
        ];
    }

    let (w, h) = rgba.dimensions();
    Some((rgba.into_raw(), w, h))
}

/// Runs the modal drag. Must be called on the main thread.
#[cfg(target_os = "windows")]
unsafe fn run_drag(paths: &[String], image: Option<(Vec<u8>, u32, u32)>) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{
        IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY,
    };
    use windows::Win32::System::Com::IBindCtx;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        ILCreateFromPathW, ILFree, SHCreateShellItemArrayFromIDLists, SHDoDragDrop, BHID_DataObject,
    };

    // OLE initialization is refcounted, and tao already claims a reference on
    // this thread for its own drop-target support — taking our own costs nothing
    // and keeps this correct if that ever stops being true.
    //
    // It is also the first thing that can go wrong in a way nothing else would
    // report: OLE drag-and-drop requires an STA, so on a thread already in an
    // MTA this returns RPC_E_CHANGED_MODE and every call below fails.
    let ole = OleInitialize(None);
    if let Err(ref e) = ole {
        crate::diag::log(&format!("drag: OleInitialize failed ({e})"));
    }

    let mut pidls: Vec<*const ITEMIDLIST> = Vec::with_capacity(paths.len());
    for path in paths {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let pidl = ILCreateFromPathW(PCWSTR(wide.as_ptr()));
        if !pidl.is_null() {
            pidls.push(pidl as *const ITEMIDLIST);
        }
    }

    let result = (|| -> Result<(), String> {
        if pidls.is_empty() {
            return Err("none of the dragged paths resolved to a file".into());
        }
        // Bound through an IShellItemArray rather than built with
        // `SHCreateDataObject`, which is the obvious call and the wrong one:
        // given a NULL parent folder and absolute PIDLs it happily returns a
        // data object that **does not offer CF_HDROP**, so every plain shell
        // target refuses the drop and the drag reads as a no-entry cursor over
        // the desktop. Binding BHID_DataObject on the item array yields the
        // same data object Explorer hands out — CF_HDROP plus FileContents,
        // FileGroupDescriptorW, Shell IDList Array and the rest.
        let items = SHCreateShellItemArrayFromIDLists(&pidls)
            .map_err(|e| format!("SHCreateShellItemArrayFromIDLists: {e}"))?;
        let data: IDataObject = items
            .BindToHandler(None::<&IBindCtx>, &BHID_DataObject)
            .map_err(|e| format!("BindToHandler(BHID_DataObject): {e}"))?;

        // That property is invisible from the outside and was wrong once, so it
        // goes in the log rather than being assumed.
        crate::diag::log(&format!(
            "drag: {} item(s), CF_HDROP {}",
            pidls.len(),
            if has_hdrop(&data) { "offered" } else { "MISSING" },
        ));

        if let Some((rgba, w, h)) = image {
            if let Err(e) = set_drag_image(&data, &rgba, w, h) {
                crate::diag::log(&format!("drag: no drag image ({e})"));
            }
        }

        // A NULL source window, because the drag image is already attached to
        // the data object above and `SHDoDragDrop` would otherwise ask that
        // window for one via DI_GETDRAGIMAGE — which WebView2 doesn't answer.
        // A NULL drop source, because the shell's default one (finish on button
        // up, cancel on Esc) is precisely the behavior wanted here.
        //
        // Cancelling is a *success* HRESULT (DRAGDROP_S_CANCEL), so a user who
        // changes their mind doesn't surface as an error. The effect the target
        // actually took is logged: DROPEFFECT_NONE on return means the drag ran
        // but nothing accepted it, which is a different bug from never starting.
        let effect = SHDoDragDrop(HWND::default(), &data, None::<&IDropSource>, DROPEFFECT_COPY)
            .map_err(|e| format!("SHDoDragDrop: {e}"))?;
        crate::diag::log(&format!("drag: finished, effect={}", effect.0));
        Ok(())
    })();
    if let Err(ref e) = result {
        crate::diag::log(&format!("drag: {e}"));
    }

    for pidl in pidls {
        ILFree(Some(pidl));
    }
    if ole.is_ok() {
        OleUninitialize();
    }
    result
}

/// Whether the data object offers CF_HDROP — the format a plain shell drop
/// target (Explorer, the desktop) needs to turn the drag into a file copy. A
/// data object missing it drags fine and gets refused everywhere, which from
/// the outside looks identical to the drag never starting.
#[cfg(target_os = "windows")]
unsafe fn has_hdrop(data: &windows::Win32::System::Com::IDataObject) -> bool {
    use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
    use windows::Win32::System::Ole::CF_HDROP;

    let fmt = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    // Not `.is_ok()`: `QueryGetData` reports an *absent* format as S_FALSE,
    // which is a success HRESULT — so `is_ok()` answers "yes" for every format
    // that isn't there.
    data.QueryGetData(&fmt) == windows::Win32::Foundation::S_OK
}

/// Attaches `rgba` to the data object as the picture dragged under the cursor.
/// Best-effort — every caller ignores the error.
#[cfg(target_os = "windows")]
unsafe fn set_drag_image(
    data: &windows::Win32::System::Com::IDataObject,
    rgba: &[u8],
    w: u32,
    h: u32,
) -> Result<(), String> {
    use windows::Win32::Foundation::{COLORREF, HANDLE, HWND, POINT, SIZE};
    use windows::Win32::Graphics::Gdi::{
        CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{IDragSourceHelper, CLSID_DragDropHelper, SHDRAGIMAGE};

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            // Negative height: top-down rows, matching the image crate's buffer
            // order, so the copy below is a straight run.
            biHeight: -(h as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let hdc = GetDC(HWND::default());
    let created = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0);
    ReleaseDC(HWND::default(), hdc);
    let hbmp = created.map_err(|e| e.to_string())?;
    if bits.is_null() {
        let _ = DeleteObject(hbmp);
        return Err("CreateDIBSection returned no pixel buffer".into());
    }

    // RGBA → BGRA, the byte order a 32bpp DIB expects.
    let dst = std::slice::from_raw_parts_mut(bits as *mut u8, rgba.len());
    for (d, s) in dst.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        d.copy_from_slice(&[s[2], s[1], s[0], s[3]]);
    }

    let shdi = SHDRAGIMAGE {
        sizeDragImage: SIZE { cx: w as i32, cy: h as i32 },
        // Where the cursor sits inside the image.
        ptOffset: POINT { x: (w / 2) as i32, y: (h / 2) as i32 },
        hbmpDragImage: hbmp,
        // CLR_NONE — alpha-blend the bitmap rather than color-key it, which is
        // what makes the premultiplied alpha above mean anything.
        crColorKey: COLORREF(0xFFFF_FFFF),
    };

    let helper: IDragSourceHelper =
        CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;

    // On success the helper takes ownership of the bitmap and frees it itself;
    // on failure it never took it, so we do.
    match helper.InitializeFromBitmap(&shdi, data) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = DeleteObject(hbmp);
            Err(e.to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[command]
pub async fn start_file_drag(_paths: Vec<String>, _app: tauri::AppHandle) -> Result<(), String> {
    Err("Dragging files out is Windows-only".into())
}
