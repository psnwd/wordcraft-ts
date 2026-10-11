#![cfg(target_arch = "wasm32")]
//! WordCraft as an embeddable browser editor.
//!
//! Same app as `wordcraft-web`, but exported through wasm-bindgen so a host page (React, Next.js,
//! plain JS) can mount it into its own `<canvas>`, load a document, and read it back. One editor
//! per page (the host handle lives in a thread-local).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wordcraft_engine::Session;
use wordcraft_ui_egui::{Inbox, Services, WordApp};

const DOC_EXTS: &[&str] = &["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf", "txt", "md", "html", "htm", "tex", "json"];
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const RECIPIENT_EXTS: &[&str] = &["csv", "tsv", "txt", "xlsx", "xlsm", "ods"];

type PasteListener = wasm_bindgen::closure::Closure<dyn FnMut(web_sys::ClipboardEvent)>;

/// What the exported functions need to reach one running editor.
struct Host {
    runner: Rc<eframe::WebRunner>,
    inbox: Inbox,
    ctx: Option<egui::Context>,
    on_dirty: Option<js_sys::Function>,
    dirty: bool,
    paste: Option<PasteListener>,
}

/// An `exportDocument` call waiting for the next frame: (editor id, file name, resolve, reject).
type ExportReq = (u32, String, js_sys::Function, js_sys::Function);

thread_local! {
    static HOSTS: RefCell<HashMap<u32, Host>> = RefCell::new(HashMap::new());
    static EXPORTS: RefCell<Vec<ExportReq>> = const { RefCell::new(Vec::new()) };
    static NEXT_ID: Cell<u32> = const { Cell::new(1) };
    /// The editor the user last pressed in: pasted pictures go there only.
    static ACTIVE: Cell<u32> = const { Cell::new(0) };
}

fn with_host<R>(id: u32, f: impl FnOnce(&mut Host) -> R) -> Result<R, JsValue> {
    HOSTS.with(|h| h.borrow_mut().get_mut(&id).map(f)).ok_or_else(|| JsValue::from_str("editor not mounted"))
}

/// Start an editor in `canvas`; resolves with its id once it is running. Any number of editors
/// can run on one page, each on its own canvas.
/// `webgl` forces the WebGL2 backend; `sample` opens the built-in sample document.
#[wasm_bindgen]
pub async fn mount(canvas: web_sys::HtmlCanvasElement, sample: bool, webgl: bool) -> Result<u32, JsValue> {
    let id = NEXT_ID.with(|n| n.replace(n.get() + 1));
    let mut options = eframe::WebOptions::default();
    if webgl && let eframe::egui_wgpu::WgpuSetup::CreateNew(create) = &mut options.wgpu_options.wgpu_setup {
        create.instance_descriptor.backends = eframe::wgpu::Backends::GL;
    }
    let inbox: Inbox = Inbox::default();
    let runner = Rc::new(eframe::WebRunner::new());
    HOSTS.with(|h| {
        h.borrow_mut().insert(id, Host { runner: runner.clone(), inbox: inbox.clone(), ctx: None, on_dirty: None, dirty: false, paste: None })
    });
    // Pressing in a canvas makes it the paste target. The listener dies with the canvas.
    let on_down = wasm_bindgen::closure::Closure::<dyn FnMut()>::new(move || ACTIVE.with(|a| a.set(id)));
    if canvas.add_event_listener_with_callback("pointerdown", on_down.as_ref().unchecked_ref()).is_ok() {
        on_down.forget();
    }
    let inbox_for_app = inbox.clone();
    let started = runner
        .start(
            canvas,
            options,
            Box::new(move |cc| {
                let paste = listen_for_pasted_pictures(id, inbox_for_app.clone(), cc.egui_ctx.clone());
                if let Err(e) = &paste {
                    log::error!("pasting pictures is unavailable: {e}");
                }
                HOSTS.with(|h| {
                    if let Some(host) = h.borrow_mut().get_mut(&id) {
                        host.ctx = Some(cc.egui_ctx.clone());
                        host.paste = paste.ok();
                    }
                });
                let doc = if sample { wordcraft_engine::sample::sample_document() } else { wordcraft_doc::Document::new() };
                let mut app = WordApp::new(Session::new(doc), services(id, inbox_for_app.clone(), cc.egui_ctx.clone()));
                app.autosave = false;
                Ok(Box::new(WebShell { id, app, inbox: inbox_for_app }))
            }),
        )
        .await;
    match started {
        Ok(()) => Ok(id),
        Err(e) => {
            HOSTS.with(|h| h.borrow_mut().remove(&id));
            Err(e)
        }
    }
}

/// Stop editor `id` and free its canvas. Unsaved changes are lost.
#[wasm_bindgen]
pub fn unmount(id: u32) {
    let Some(host) = HOSTS.with(|h| h.borrow_mut().remove(&id)) else { return };
    if let (Some(l), Some(doc)) = (&host.paste, web_sys::window().and_then(|w| w.document())) {
        let _ = doc.remove_event_listener_with_callback("paste", l.as_ref().unchecked_ref());
    }
    host.runner.destroy();
    EXPORTS.with(|e| {
        e.borrow_mut().retain(|(i, _, _, reject)| {
            if *i == id {
                let _ = reject.call1(&JsValue::NULL, &JsValue::from_str("editor unmounted"));
            }
            *i != id
        })
    });
}

/// Open a document (or insert a picture) from bytes. `name` picks the format by extension.
#[wasm_bindgen(js_name = loadFile)]
pub fn load_file(id: u32, name: String, bytes: Vec<u8>) -> Result<(), JsValue> {
    with_host(id, |host| {
        host.inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
        if let Some(ctx) = &host.ctx {
            ctx.request_repaint();
        }
    })
}

/// Serialize editor `id`'s document. `name`'s extension picks the format (docx, odt, rtf, html,
/// md, txt). Resolves with a `Uint8Array` on the next frame.
#[wasm_bindgen(js_name = exportDocument)]
pub fn export_document(id: u32, name: String) -> js_sys::Promise {
    js_sys::Promise::new(&mut |resolve, reject| {
        let queued = with_host(id, |host| {
            if let Some(ctx) = &host.ctx {
                ctx.request_repaint();
            }
        });
        match queued {
            Ok(()) => EXPORTS.with(|e| e.borrow_mut().push((id, name.clone(), resolve, reject))),
            Err(e) => {
                let _ = reject.call1(&JsValue::NULL, &e);
            }
        }
    })
}

/// Called with `true`/`false` whenever editor `id`'s unsaved-changes flag flips. `null` clears.
#[wasm_bindgen(js_name = onDirty)]
pub fn on_dirty(id: u32, cb: Option<js_sys::Function>) {
    let _ = with_host(id, |host| host.on_dirty = cb);
}

fn notify_dirty(id: u32, d: bool) {
    let cb = HOSTS.with(|h| {
        let mut h = h.borrow_mut();
        let host = h.get_mut(&id)?;
        if host.dirty == d {
            return None;
        }
        host.dirty = d;
        host.on_dirty.clone()
    });
    if let Some(cb) = cb {
        let _ = cb.call1(&JsValue::NULL, &JsValue::from_bool(d));
    }
}

fn serve_exports(id: u32, app: &WordApp) {
    let (mine, rest): (Vec<_>, Vec<_>) = EXPORTS.with(|e| std::mem::take(&mut *e.borrow_mut())).into_iter().partition(|r| r.0 == id);
    EXPORTS.with(|e| e.borrow_mut().extend(rest));
    for (_, name, resolve, reject) in mine {
        match wordcraft_engine::io::save_bytes(&name, &app.session.doc) {
            Ok(bytes) => {
                let _ = resolve.call1(&JsValue::NULL, &js_sys::Uint8Array::from(bytes.as_slice()));
            }
            Err(e) => {
                let _ = reject.call1(&JsValue::NULL, &JsValue::from_str(&e));
            }
        }
    }
}

/// Wraps the app to read dropped files asynchronously (browsers can't read them synchronously)
/// and feed them through the inbox.
struct WebShell {
    id: u32,
    app: WordApp,
    inbox: Inbox,
}

impl eframe::App for WebShell {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let dropped = ctx.input_mut(|i| std::mem::take(&mut i.raw.dropped_files));
        for f in dropped {
            let inbox = self.inbox.clone();
            let ctx = ctx.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let name = f.path().file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "dropped".into());
                match f.bytes_async().await {
                    Ok(bytes) => {
                        inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
                        ctx.request_repaint();
                    }
                    Err(e) => log::error!("couldn't read dropped file {name}: {e}"),
                }
            });
        }
        self.app.logic(ctx);
        serve_exports(self.id, &self.app);
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
    }
}

/// Largest picture pasted from the browser's clipboard (as `insert.picture` allows).
const MAX_PASTED_BYTES: f64 = (200u32 << 20) as f64;
/// Most pictures one paste inserts.
const MAX_PASTED_PICTURES: u32 = 20;

/// Pasting a picture (#45): eframe's paste handler only reads text, so a clipboard holding just
/// pictures (a screenshot, a browser's Copy Image) is read here and the pictures arrive through
/// the inbox like dropped ones. A clipboard with text is left to eframe.
fn listen_for_pasted_pictures(id: u32, inbox: Inbox, ctx: egui::Context) -> Result<PasteListener, String> {
    let document = web_sys::window().and_then(|w| w.document()).ok_or("no document")?;
    let on_paste = wasm_bindgen::closure::Closure::<dyn FnMut(web_sys::ClipboardEvent)>::new(move |e: web_sys::ClipboardEvent| {
        if ACTIVE.with(Cell::get) != id {
            return;
        }
        let Some(data) = e.clipboard_data() else { return };
        if !data.get_data("text").unwrap_or_default().is_empty() {
            return;
        }
        let Some(files) = data.files() else { return };
        for i in 0..files.length().min(MAX_PASTED_PICTURES) {
            let Some(file) = files.get(i) else { continue };
            if !file.type_().starts_with("image/") {
                continue;
            }
            if file.size() > MAX_PASTED_BYTES {
                log::warn!("pasted picture is larger than 200 MB; not inserted");
                continue;
            }
            let inbox = inbox.clone();
            let ctx = ctx.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match wasm_bindgen_futures::JsFuture::from(file.array_buffer()).await {
                    Ok(buf) => {
                        let bytes = js_sys::Uint8Array::new(&buf).to_vec();
                        // The inbox inserts files named like pictures; the engine reads the format from the bytes.
                        inbox.lock().unwrap_or_else(|e| e.into_inner()).push(("pasted.png".into(), bytes));
                        ctx.request_repaint();
                    }
                    Err(e) => log::error!("couldn't read the pasted picture: {e:?}"),
                }
            });
        }
    });
    document.add_event_listener_with_callback("paste", on_paste.as_ref().unchecked_ref()).map_err(|e| format!("{e:?}"))?;
    Ok(on_paste)
}

fn services(id: u32, inbox: Inbox, ctx: egui::Context) -> Services {
    let open_inbox = inbox.clone();
    Services {
        open_async: Some(Box::new(move |purpose: &str| {
            let inbox = open_inbox.clone();
            let ctx = ctx.clone();
            let dialog = if purpose == "picture" {
                rfd::AsyncFileDialog::new().add_filter("Pictures", IMAGE_EXTS)
            } else if purpose == "recipients" {
                rfd::AsyncFileDialog::new().add_filter("Recipient lists", RECIPIENT_EXTS)
            } else {
                rfd::AsyncFileDialog::new().add_filter("Documents", DOC_EXTS)
            };
            wasm_bindgen_futures::spawn_local(async move {
                let Some(file) = dialog.pick_file().await else {
                    return;
                };
                let bytes = file.read().await;
                inbox.lock().unwrap_or_else(|e| e.into_inner()).push((file.file_name(), bytes));
                ctx.request_repaint();
            });
        })),
        // Exports ask for a name; the browser decides where the download goes.
        pick_save: Some(Box::new(|name: &str| Some(name.to_string()))),
        download: Some(Box::new(download)),
        print: Some(Box::new(print_pdf)),
        inbox: Some(inbox),
        on_dirty: Some(Box::new(move |d| notify_dirty(id, d))),
        ..Default::default()
    }
}

/// Trigger a browser download of `bytes` named after the last component of `path`.
fn download(path: &str, bytes: &[u8]) -> Result<(), String> {
    let js = |e: wasm_bindgen::JsValue| format!("{e:?}");
    let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "document".into());
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime_for(&name));
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts).map_err(js)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js)?;
    let a: web_sys::HtmlAnchorElement = document.create_element("a").map_err(js)?.dyn_into().map_err(|_| "not an anchor")?;
    a.set_href(&url);
    a.set_download(&name);
    a.style().set_property("display", "none").map_err(js)?;
    let body = document.body().ok_or("no body")?;
    body.append_child(&a).map_err(js)?;
    a.click();
    a.remove();
    // Revoke after the click has been dispatched; the download keeps its own reference.
    let revoke = wasm_bindgen::closure::Closure::once_into_js(move || {
        web_sys::Url::revoke_object_url(&url).ok();
    });
    window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), 10_000).map_err(js)?;
    Ok(())
}

/// The hidden iframe the last print loaded its PDF into.
const PRINT_FRAME_ID: &str = "wordcraft-print-frame";

/// Opens `bytes` (a PDF) as an object URL in a hidden iframe and calls the
/// iframe's own `print()` once it has finished loading — this is the
/// standard way to drive the browser's native print dialog on a PDF without
/// a download or a popup window the browser might block. The previous
/// print's iframe and object URL are removed first, so only one copy of the
/// document's PDF stays in the page (the last one may still be printing).
fn print_pdf(bytes: &[u8]) -> Result<(), String> {
    let js = |e: wasm_bindgen::JsValue| format!("{e:?}");
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;

    if let Some(old) = document.get_element_by_id(PRINT_FRAME_ID) {
        if let Ok(frame) = old.clone().dyn_into::<web_sys::HtmlIFrameElement>() {
            let src = frame.src();
            if src.starts_with("blob:") {
                web_sys::Url::revoke_object_url(&src).ok();
            }
        }
        old.remove();
    }

    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type("application/pdf");
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts).map_err(js)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js)?;

    let iframe: web_sys::HtmlIFrameElement =
        match document.create_element("iframe").map_err(js).and_then(|e| e.dyn_into().map_err(|_| "not an iframe".to_string())) {
            Ok(f) => f,
            Err(e) => {
                web_sys::Url::revoke_object_url(&url).ok();
                return Err(e);
            }
        };
    iframe.set_id(PRINT_FRAME_ID);
    let attached = iframe
        .style()
        .set_property("display", "none")
        .map_err(js)
        .and_then(|()| document.body().ok_or_else(|| "no body".to_string()))
        .and_then(|body| body.append_child(&iframe).map_err(js));
    if let Err(e) = attached {
        iframe.remove();
        web_sys::Url::revoke_object_url(&url).ok();
        return Err(e);
    }

    // `onload` fires once the PDF has actually rendered inside the iframe;
    // printing before that would show a blank page. Set the handler BEFORE
    // `src` so a fast/cached load can't fire before we're listening.
    let iframe_for_load = iframe.clone();
    let on_load = wasm_bindgen::closure::Closure::once_into_js(move || {
        if let Some(w) = iframe_for_load.content_window() {
            // Ignore errors: some browsers (notably Firefox with a built-in
            // PDF viewer) print fine but report a benign cross-origin-style
            // error back on this call.
            let _ = w.print();
        }
    });
    iframe.set_onload(Some(on_load.unchecked_ref()));
    iframe.set_src(&url);
    Ok(())
}

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("pdf") => "application/pdf",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("odt") => "application/vnd.oasis.opendocument.text",
        Some("rtf") => "application/rtf",
        Some("html") => "text/html",
        Some("md" | "txt") => "text/plain",
        Some("tex") => "application/x-tex",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}
