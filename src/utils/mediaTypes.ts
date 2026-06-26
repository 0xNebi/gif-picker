import { invoke } from "@tauri-apps/api/core";

export type MediaKind = "image" | "gif" | "video";

export interface MediaFile {
  path: string;
  name: string;
  folderPath: string;
  kind: MediaKind;
}

export interface ScannedMediaFile {
  path: string;
  folderPath: string;
  kind: MediaKind;
}

export async function scanMediaFolders(
  folderPaths: string[],
  includeVideos: boolean,
): Promise<ScannedMediaFile[]> {
  return invoke<ScannedMediaFile[]>("scan_media_folders", {
    folderPaths,
    includeVideos,
  });
}

const GIF_EXTENSIONS = new Set([".gif"]);
const IMAGE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg", ".apng"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".gifv"]);

export function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

export function getMediaKind(path: string): MediaKind | null {
  const ext = getExtension(path);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (GIF_EXTENSIONS.has(ext)) return "gif";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

/** Resolves media kind from extension, sniffing .gif files that may be mislabeled videos. */
export async function resolveMediaKind(path: string): Promise<MediaKind | null> {
  const kind = getMediaKind(path);
  if (!kind || getExtension(path) !== ".gif") {
    return kind;
  }

  try {
    const sniffed = await invoke<string | null>("sniff_media_kind", { path });
    if (sniffed === "video") return "video";
    if (sniffed === "image") return "image";
    if (sniffed === "gif") return "gif";
  } catch (error) {
    console.warn("[gif-picker] media sniff failed for", path, error);
  }

  return kind;
}

export function getMediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case "video":
      return "VIDEO";
    case "gif":
      return "GIF";
    case "image":
      return "IMAGE";
  }
}

export function isGifPath(path: string): boolean {
  return getMediaKind(path) === "gif";
}

export function isVideoPath(path: string): boolean {
  return getMediaKind(path) === "video";
}

export function mimeForPath(path: string): string {
  const ext = getExtension(path);
  switch (ext) {
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp4":
    case ".gifv":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "image/gif";
  }
}