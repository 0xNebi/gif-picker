import { invoke } from "@tauri-apps/api/core";

export interface DuplicateFileEntry {
  path: string;
  size: number;
}

export interface DuplicateFileGroup {
  hash: string;
  files: DuplicateFileEntry[];
}

export async function findDuplicateFiles(
  paths: string[],
): Promise<DuplicateFileGroup[]> {
  return invoke<DuplicateFileGroup[]>("find_duplicate_files", { paths });
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