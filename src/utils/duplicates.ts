import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DuplicateFileEntry {
  path: string;
  size: number;
}

export interface DuplicateFileGroup {
  hash: string;
  files: DuplicateFileEntry[];
}

export interface DuplicateScanProgress {
  phase: "metadata" | "hashing";
  scanned: number;
  total: number;
  currentPath?: string;
}

function normalizeScanProgress(
  payload: DuplicateScanProgress,
): DuplicateScanProgress {
  return {
    ...payload,
    phase: payload.phase === "hashing" ? "hashing" : "metadata",
  };
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }

  return unique;
}

export async function findDuplicateFiles(
  paths: string[],
  onProgress?: (progress: DuplicateScanProgress) => void,
): Promise<DuplicateFileGroup[]> {
  let unlisten: UnlistenFn | undefined;

  if (onProgress) {
    unlisten = await listen<DuplicateScanProgress>(
      "duplicate-scan-progress",
      (event) => {
        onProgress(normalizeScanProgress(event.payload));
      },
    );
  }

  try {
    return await invoke<DuplicateFileGroup[]>("find_duplicate_files", {
      paths: uniquePaths(paths),
    });
  } finally {
    await unlisten?.();
  }
}

export function pathsToExcludeFromDuplicateGroups(
  groups: DuplicateFileGroup[],
): string[] {
  const paths: string[] = [];

  for (const group of groups) {
    const [, ...duplicates] = group.files;
    for (const file of duplicates) {
      paths.push(file.path);
    }
  }

  return paths;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function duplicateScanProgressPercent(
  progress: DuplicateScanProgress,
): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.scanned / progress.total) * 100));
}

export function duplicateScanProgressLabel(
  progress: DuplicateScanProgress,
): string {
  if (progress.phase === "metadata") {
    return `Scanning file sizes… ${progress.scanned} / ${progress.total}`;
  }

  if (progress.total <= 0) {
    return "No size matches to compare";
  }

  return `Comparing file contents… ${progress.scanned} / ${progress.total}`;
}

export function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}