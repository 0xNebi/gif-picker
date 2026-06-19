import { invoke } from "@tauri-apps/api/core";

export async function copyPathToClipboard(path: string): Promise<void> {
  await invoke("copy_text_to_clipboard", { text: path });
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