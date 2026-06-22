import { invoke } from "@tauri-apps/api/core";

export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_url", { url });
}