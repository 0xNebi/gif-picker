import { invoke } from "@tauri-apps/api/core";

export function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export async function copyPathToClipboard(path: string): Promise<void> {
  await invoke("copy_text_to_clipboard", { text: path });
}

export async function copyNameToClipboard(path: string): Promise<void> {
  await invoke("copy_text_to_clipboard", { text: fileNameFromPath(path) });
}

export async function copyMediaToClipboard(
  path: string,
  options?: { asGif?: boolean },
): Promise<void> {
  await invoke("copy_media_to_clipboard", {
    path,
    asGif: options?.asGif ?? false,
  });
}