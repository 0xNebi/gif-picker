export type MediaKind = "image" | "video";

export interface MediaFile {
  path: string;
  name: string;
  folderPath: string;
  kind: MediaKind;
}

const IMAGE_EXTENSIONS = new Set([".gif", ".webp", ".png", ".jpg", ".jpeg", ".apng"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".gifv"]);

export function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

export function getMediaKind(path: string): MediaKind | null {
  const ext = getExtension(path);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

export function isVideoPath(path: string): boolean {
  return getMediaKind(path) === "video";
}

export function matchesMediaFilter(
  name: string,
  includeVideos: boolean,
): boolean {
  const lower = name.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  if (includeVideos) {
    for (const ext of VIDEO_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
  }
  return false;
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