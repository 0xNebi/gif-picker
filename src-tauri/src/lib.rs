use std::collections::{HashMap, HashSet};
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

/// Opens a URL in the user's default browser.
#[tauri::command]
async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {e}"))
}

#[derive(Serialize, Clone)]
struct DiscordDownloadProgress {
    downloaded: usize,
    skipped: usize,
    failed: usize,
    total: usize,
    current_url: Option<String>,
    current_file: Option<String>,
}

#[derive(Serialize)]
struct DiscordDownloadResult {
    downloaded: usize,
    skipped: usize,
    failed: usize,
    dest_dir: String,
    paths: Vec<String>,
}

fn sniff_media_extension(header: &[u8]) -> Option<&'static str> {
    if header.len() >= 6
        && (header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a"))
    {
        return Some("gif");
    }
    if header.len() >= 4 && header.starts_with(b"\x89PNG") {
        return Some("png");
    }
    if header.len() >= 12 && header.starts_with(b"RIFF") && &header[8..12] == b"WEBP" {
        return Some("webp");
    }
    if header.len() >= 3 && header.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if header.len() >= 4 && header.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some("webm");
    }
    if header.len() >= 12 && &header[4..8] == b"ftyp" {
        return Some("mp4");
    }
    None
}

fn sniff_media_kind_label(header: &[u8]) -> Option<&'static str> {
    match sniff_media_extension(header)? {
        "gif" => Some("gif"),
        "mp4" | "webm" | "mov" | "mkv" | "m4v" | "avi" | "gifv" => Some("video"),
        _ => Some("image"),
    }
}

fn extension_from_content_type(content_type: &str) -> Option<&'static str> {
    let content_type = content_type.split(';').next()?.trim().to_ascii_lowercase();
    match content_type.as_str() {
        "image/gif" => Some("gif"),
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/quicktime" => Some("mov"),
        _ => None,
    }
}

fn read_file_header(path: &Path) -> Result<[u8; 16], String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut header = [0u8; 16];
    let _read = file
        .read(&mut header)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    Ok(header)
}

fn correct_media_extension(path: &Path, preferred_extension: Option<&str>) -> Result<PathBuf, String> {
    let header = read_file_header(path)?;
    let detected = sniff_media_extension(&header).or(preferred_extension);

    let Some(detected) = detected else {
        return Ok(path.to_path_buf());
    };

    let current_ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if current_ext == detected {
        return Ok(path.to_path_buf());
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("Invalid media path: {}", path.display()))?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("discord-media");
    let corrected_name = format!("{stem}.{detected}");
    let corrected_path = unique_dest_path(parent, &corrected_name);

    if corrected_path != path {
        std::fs::rename(path, &corrected_path).map_err(|error| {
            format!(
                "Failed to rename {} to {}: {error}",
                path.display(),
                corrected_path.display()
            )
        })?;
    }

    Ok(corrected_path)
}

/// Detects media kind from file header bytes (used for mislabeled Discord downloads).
#[tauri::command]
fn sniff_media_kind(path: String) -> Result<Option<String>, String> {
    let file_path = PathBuf::from(&path);
    let header = read_file_header(&file_path)?;
    Ok(sniff_media_kind_label(&header).map(str::to_string))
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect();

    let trimmed = cleaned.trim_matches('.').trim();
    if trimmed.is_empty() {
        "discord-gif".to_string()
    } else {
        trimmed.to_string()
    }
}

fn filename_from_url(url: &str, index: usize) -> String {
    let without_query = url.split('?').next().unwrap_or(url);
    let segment = without_query
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or("");

    let decoded = segment
        .replace("%20", " ")
        .replace("%2F", "/")
        .replace("%3A", ":");

    let mut name = sanitize_filename(&decoded);
    if name.is_empty() {
        name = format!("discord-gif-{index:04}");
    }

    if !name.contains('.') {
        name.push_str(".gif");
    }

    name
}

fn unique_dest_path(dest_dir: &Path, base_name: &str) -> PathBuf {
    let mut candidate = dest_dir.join(base_name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, extension) = match base_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), Some(ext.to_string())),
        _ => (base_name.to_string(), None),
    };

    for suffix in 1..1000 {
        let next_name = match &extension {
            Some(ext) => format!("{stem}-{suffix}.{ext}"),
            None => format!("{stem}-{suffix}"),
        };
        candidate = dest_dir.join(&next_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    dest_dir.join(format!("{stem}-dup"))
}

fn emit_discord_download_progress(app: &tauri::AppHandle, progress: DiscordDownloadProgress) {
    let _ = app.emit("discord-download-progress", progress);
}

fn download_discord_gifs_blocking(
    app: tauri::AppHandle,
    urls: Vec<String>,
    dest_dir: String,
) -> Result<DiscordDownloadResult, String> {
    let destination = PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&destination)
        .map_err(|error| format!("Failed to create destination folder: {error}"))?;

    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(60))
        .build();

    let total = urls.len();
    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut paths = Vec::new();

    for (index, url) in urls.iter().enumerate() {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            skipped += 1;
            continue;
        }

        let base_name = filename_from_url(trimmed, index + 1);
        let dest_path = unique_dest_path(&destination, &base_name);
        let dest_display = dest_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string());

        emit_discord_download_progress(
            &app,
            DiscordDownloadProgress {
                downloaded,
                skipped,
                failed,
                total,
                current_url: Some(trimmed.to_string()),
                current_file: dest_display.clone(),
            },
        );

        if dest_path.exists() {
            skipped += 1;
            let final_path = match correct_media_extension(&dest_path, None) {
                Ok(path) => path,
                Err(error) => {
                    eprintln!(
                        "[gif-picker] Failed to correct media extension for {}: {error}",
                        dest_path.display()
                    );
                    dest_path
                }
            };
            if let Some(path) = final_path.to_str() {
                paths.push(path.to_string());
            }
            continue;
        }

        let response = match agent.get(trimmed).call() {
            Ok(response) => response,
            Err(error) => {
                failed += 1;
                eprintln!("[gif-picker] Discord GIF download failed for {trimmed}: {error}");
                continue;
            }
        };

        if !(200..300).contains(&response.status()) {
            failed += 1;
            eprintln!(
                "[gif-picker] Discord GIF download failed for {trimmed}: HTTP {}",
                response.status()
            );
            continue;
        }

        let content_type = response
            .header("Content-Type")
            .unwrap_or_default()
            .to_string();
        let preferred_extension = extension_from_content_type(&content_type);

        let mut reader = response.into_reader();
        let mut file = match std::fs::File::create(&dest_path) {
            Ok(file) => file,
            Err(error) => {
                failed += 1;
                eprintln!(
                    "[gif-picker] Failed to write {}: {error}",
                    dest_path.display()
                );
                continue;
            }
        };

        if let Err(error) = std::io::copy(&mut reader, &mut file) {
            failed += 1;
            let _ = std::fs::remove_file(&dest_path);
            eprintln!(
                "[gif-picker] Failed to save {}: {error}",
                dest_path.display()
            );
            continue;
        }

        let final_path = match correct_media_extension(&dest_path, preferred_extension) {
            Ok(path) => path,
            Err(error) => {
                eprintln!(
                    "[gif-picker] Failed to correct media extension for {}: {error}",
                    dest_path.display()
                );
                dest_path
            }
        };

        downloaded += 1;
        if let Some(path) = final_path.to_str() {
            paths.push(path.to_string());
        }
    }

    emit_discord_download_progress(
        &app,
        DiscordDownloadProgress {
            downloaded,
            skipped,
            failed,
            total,
            current_url: None,
            current_file: None,
        },
    );

    Ok(DiscordDownloadResult {
        downloaded,
        skipped,
        failed,
        dest_dir,
        paths,
    })
}

/// Downloads Discord favorite GIF URLs into a local folder.
#[tauri::command]
async fn download_discord_gifs(
    app: tauri::AppHandle,
    urls: Vec<String>,
    dest_dir: String,
) -> Result<DiscordDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || download_discord_gifs_blocking(app, urls, dest_dir))
        .await
        .map_err(|error| format!("Discord download task failed: {error}"))?
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

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut unique = Vec::with_capacity(paths.len());
    let mut seen = HashSet::with_capacity(paths.len());

    for path in paths {
        if seen.insert(path.clone()) {
            unique.push(path);
        }
    }

    unique
}

fn find_duplicate_files_blocking(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<DuplicateFileGroup>, String> {
    let paths = dedupe_paths(paths);
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
        let group = by_hash.entry(hash).or_default();
        if group.iter().any(|entry| entry.path == path) {
            continue;
        }
        group.push(DuplicateFileEntry { path, size });
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
            open_url,
            copy_text_to_clipboard,
            copy_media_to_clipboard,
            migrate_legacy_app_data,
            get_app_data_dir,
            find_duplicate_files,
            download_discord_gifs,
            sniff_media_kind,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}