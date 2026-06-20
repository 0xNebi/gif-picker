import { invoke } from "@tauri-apps/api/core";

export async function openFile(path: string): Promise<void> {
  await invoke("reveal_in_explorer", { path });
}

export async function openContainingFolder(path: string): Promise<void> {
  const parent = path.replace(/[\\/][^\\/]+$/, "");
  await invoke("reveal_in_explorer", { path: parent || path });
}