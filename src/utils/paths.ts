import type { WatchedFolder } from "../store/useLibraryStore";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function matchFolderForPath(
  filePath: string,
  folders: WatchedFolder[],
): string | null {
  const normalized = normalizePath(filePath);
  let best: string | null = null;
  let bestLength = -1;

  for (const folder of folders) {
    const folderPath = normalizePath(folder.path);
    if (
      normalized === folderPath ||
      normalized.startsWith(`${folderPath}/`)
    ) {
      if (folderPath.length > bestLength) {
        best = folderPath;
        bestLength = folderPath.length;
      }
    }
  }

  return best;
}

export function groupPathsByFolder(
  paths: string[],
  folders: WatchedFolder[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const path of paths) {
    const folderPath = matchFolderForPath(path, folders) ?? "";
    const list = groups.get(folderPath) ?? [];
    list.push(path);
    groups.set(folderPath, list);
  }

  return groups;
}