use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;
use tauri::path::BaseDirectory;
use tauri_plugin_opener::OpenerExt;

const LEGACY_APP_IDENTIFIERS: &[&str] = &["com.gifpicker.app"];

const CONFIG_FILES: &[&str] = &[
    "gif-picker-library.json",
    "gif-picker-settings.json",
    "gif-picker-session.json",
    "gif-picker-folders.json",
];

fn legacy_app_data_roots(current_app_data: &Path) -> Vec<PathBuf> {
    let Some(parent) = current_app_data.parent() else {
        return Vec::new();
    };

    LEGACY_APP_IDENTIFIERS
        .iter()
        .map(|identifier| parent.join(identifier))
        .filter(|path| path.is_dir())
        .collect()
}

fn library_needs_migration(dest: &Path) -> Result<bool, String> {
    if !dest.is_file() {
        return Ok(true);
    }

    let raw = std::fs::read_to_string(dest).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid library JSON: {e}"))?;

    let folders_empty = parsed
        .get("folders")
        .and_then(|value| value.as_array())
        .map(|folders| folders.is_empty())
        .unwrap_or(true);

    Ok(folders_empty)
}

fn should_migrate_file(file_name: &str, dest: &Path) -> Result<bool, String> {
    match file_name {
        "gif-picker-library.json" => library_needs_migration(dest),
        _ => Ok(!dest.is_file()),
    }
}

/// Copies config from older app-data folders (e.g. after changing bundle identifier).
#[tauri::command]
fn migrate_legacy_app_data(app: tauri::AppHandle) -> Result<u32, String> {
    let current_dir = app
        .path()
        .resolve("", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&current_dir).map_err(|e| e.to_string())?;

    let mut migrated = 0u32;

    for legacy_dir in legacy_app_data_roots(&current_dir) {
        for file_name in CONFIG_FILES {
            let source = legacy_dir.join(file_name);
            if !source.is_file() {
                continue;
            }

            let dest = current_dir.join(file_name);
            if !should_migrate_file(file_name, &dest)? {
                continue;
            }

            std::fs::copy(&source, &dest).map_err(|e| {
                format!(
                    "Failed to migrate {file_name} from {}: {e}",
                    legacy_dir.display()
                )
            })?;
            migrated += 1;
        }
    }

    Ok(migrated)
}

/// Returns the OS app-data directory used for library/settings persistence.
#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .resolve("", BaseDirectory::AppData)
        .map_err(|e| e.to_string())
        .and_then(|path| {
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "App data path is not valid UTF-8".to_string())
        })
}

/// Opens a file or folder in the system file explorer.
#[tauri::command]
async fn reveal_in_explorer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open path: {e}"))
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

fn is_video_extension(ext: &str) -> bool {
    matches!(
        ext,
        "mp4" | "webm" | "mov" | "mkv" | "m4v" | "avi" | "gifv"
    )
}

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn copy_image_file_to_clipboard(path: &Path) -> Result<(), String> {
    let img = image::open(path).map_err(|e| format!("Failed to open image: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: rgba.into_raw().into(),
        })
        .map_err(|e| format!("Failed to copy image: {e}"))
}

#[cfg(target_os = "windows")]
fn copy_file_to_clipboard(path: &str) -> Result<(), String> {
    use clipboard_win::{formats::FileList, Clipboard, Setter};

    let _clip = Clipboard::new_attempts(10)
        .map_err(|e| format!("Failed to open clipboard: {e}"))?;
    FileList
        .write_clipboard(std::slice::from_ref(&path))
        .map_err(|e| format!("Failed to copy file to clipboard: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn copy_file_to_clipboard(path: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(path).map_err(|e| e.to_string())
}

fn clipboard_gif_temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("gif-picker-clipboard")
}

/// Stages a `.gif` filename for clipboard file copy. Uses a hard link when possible to avoid
/// duplicating large files on the same volume.
fn stage_gif_alias(source: &Path) -> Result<std::path::PathBuf, String> {
    let temp_dir = clipboard_gif_temp_dir();
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create clipboard temp dir: {e}"))?;

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let dest = temp_dir.join(format!("{stem}.gif"));

    if dest.exists() {
        std::fs::remove_file(&dest)
            .map_err(|e| format!("Failed to replace staged .gif alias: {e}"))?;
    }

    if std::fs::hard_link(source, &dest).is_err() {
        std::fs::copy(source, &dest)
            .map_err(|e| format!("Failed to stage .gif alias: {e}"))?;
    }

    Ok(dest)
}

/// Copies a non-GIF source as a `.gif` file on the clipboard.
fn copy_file_as_gif_to_clipboard(source: &Path) -> Result<(), String> {
    let dest = stage_gif_alias(source)?;
    let dest_str = dest
        .to_str()
        .ok_or_else(|| "Clipboard temp path is not valid UTF-8".to_string())?;
    copy_file_to_clipboard(dest_str)
}

fn copy_media_default(file_path: &Path, path: &str, ext: &str) -> Result<(), String> {
    if is_video_extension(ext) || ext == "gif" {
        copy_file_to_clipboard(path)
    } else {
        copy_image_file_to_clipboard(file_path)
    }
}

/// Copies image bytes to the clipboard, or the file itself for video/GIF formats.
#[tauri::command]
fn copy_media_to_clipboard(path: String, as_gif: bool) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {path}"));
    }

    let ext = file_extension(file_path);

    // Native GIFs always copy as the real file so paste keeps .gif (not a PNG bitmap).
    if ext == "gif" {
        return copy_file_to_clipboard(&path);
    }

    if as_gif {
        return copy_file_as_gif_to_clipboard(file_path);
    }

    copy_media_default(file_path, &path, &ext)
}

#[derive(Serialize, Clone)]
struct DuplicateFileEntry {
    path: String,
    size: u64,
}

#[derive(Serialize, Clone)]
struct DuplicateFileGroup {
    hash: String,
    files: Vec<DuplicateFileEntry>,
}

#[derive(Serialize, Clone)]
struct DuplicateScanProgress {
    phase: String,
    scanned: usize,
    total: usize,
    current_path: Option<String>,
}

const HASH_READ_BUFFER_BYTES: usize = 256 * 1024;

fn emit_scan_progress(app: &tauri::AppHandle, progress: DuplicateScanProgress) {
    let _ = app.emit("duplicate-scan-progress", progress);
}

fn hash_file_streaming(path: &str) -> Result<(String, u64, String), String> {
    let file_path = Path::new(path);
    let file = std::fs::File::open(file_path)
        .map_err(|error| format!("Failed to open {path}: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("Failed to read metadata for {path}: {error}"))?
        .len();

    let mut hasher = Sha256::new();
    let mut reader = std::io::BufReader::with_capacity(HASH_READ_BUFFER_BYTES, file);
    let mut buffer = [0u8; HASH_READ_BUFFER_BYTES];

    loop {
        let read_bytes = reader
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read {path}: {error}"))?;
        if read_bytes == 0 {
            break;
        }
        hasher.update(&buffer[..read_bytes]);
    }

    Ok((path.to_string(), size, format!("{:x}", hasher.finalize())))
}

fn find_duplicate_files_blocking(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<DuplicateFileGroup>, String> {
    let total = paths.len();
    let mut by_size: HashMap<u64, Vec<String>> = HashMap::new();

    for (index, path) in paths.iter().enumerate() {
        let file_path = Path::new(path);
        if file_path.is_file() {
            if let Ok(metadata) = std::fs::metadata(file_path) {
                by_size
                    .entry(metadata.len())
                    .or_default()
                    .push(path.clone());
            }
        }

        let scanned = index + 1;
        if scanned == 1 || scanned == total || scanned % 8 == 0 {
            emit_scan_progress(
                &app,
                DuplicateScanProgress {
                    phase: "metadata".to_string(),
                    scanned,
                    total,
                    current_path: Some(path.clone()),
                },
            );
        }
    }

    let candidates: Vec<String> = by_size
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    let hash_total = candidates.len();
    if hash_total == 0 {
        emit_scan_progress(
            &app,
            DuplicateScanProgress {
                phase: "hashing".to_string(),
                scanned: 0,
                total: 0,
                current_path: None,
            },
        );
        return Ok(Vec::new());
    }

    let hash_scanned = AtomicUsize::new(0);
    let hash_emit_every = (hash_total / 100).max(1);

    let hashed = candidates
        .par_iter()
        .map(|path| -> Result<(String, u64, String), String> {
            let result = hash_file_streaming(path)?;
            let scanned = hash_scanned.fetch_add(1, Ordering::Relaxed) + 1;
            if scanned == 1 || scanned == hash_total || scanned % hash_emit_every == 0 {
                emit_scan_progress(
                    &app,
                    DuplicateScanProgress {
                        phase: "hashing".to_string(),
                        scanned,
                        total: hash_total,
                        current_path: Some(path.clone()),
                    },
                );
            }
            Ok(result)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut by_hash: HashMap<String, Vec<DuplicateFileEntry>> = HashMap::new();
    for (path, size, hash) in hashed {
        by_hash
            .entry(hash)
            .or_default()
            .push(DuplicateFileEntry { path, size });
    }

    let mut groups: Vec<DuplicateFileGroup> = by_hash
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .map(|(hash, mut files)| {
            files.sort_by(|a, b| a.path.cmp(&b.path));
            DuplicateFileGroup { hash, files }
        })
        .collect();

    groups.sort_by(|a, b| {
        b.files
            .len()
            .cmp(&a.files.len())
            .then_with(|| a.files[0].path.cmp(&b.files[0].path))
    });

    Ok(groups)
}

/// Groups library files by exact content hash (SHA-256).
#[tauri::command]
async fn find_duplicate_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<DuplicateFileGroup>, String> {
    tauri::async_runtime::spawn_blocking(move || find_duplicate_files_blocking(app, paths))
        .await
        .map_err(|error| format!("Duplicate scan task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }));
    }

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            reveal_in_explorer,
            copy_text_to_clipboard,
            copy_media_to_clipboard,
            migrate_legacy_app_data,
            get_app_data_dir,
            find_duplicate_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}