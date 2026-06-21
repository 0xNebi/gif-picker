import {
  BaseDirectory,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const DISCORD_IMPORTS_FILE = "gif-picker-discord-imports.json";

export interface DiscordImportRecord {
  destDir: string;
  urls: string[];
  updatedAt: string;
}

interface DiscordImportsFile {
  imports: Record<string, DiscordImportRecord>;
}

const DEFAULT_STATE: DiscordImportsFile = {
  imports: {},
};

function normalizeDestDir(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    // directory already exists
  }
}

async function readDiscordImportsFile(): Promise<DiscordImportsFile> {
  try {
    await ensureAppDataDir();
    const raw = await readTextFile(DISCORD_IMPORTS_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(raw) as Partial<DiscordImportsFile>;
    return {
      imports: parsed.imports ?? {},
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeDiscordImportsFile(data: DiscordImportsFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(DISCORD_IMPORTS_FILE, JSON.stringify(data, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function loadDiscordImportRecord(
  destDir: string,
): Promise<DiscordImportRecord | null> {
  const normalized = normalizeDestDir(destDir);
  const file = await readDiscordImportsFile();
  return file.imports[normalized] ?? null;
}

export async function saveDiscordImportRecord(
  destDir: string,
  urls: string[],
): Promise<void> {
  const normalized = normalizeDestDir(destDir);
  const file = await readDiscordImportsFile();
  file.imports[normalized] = {
    destDir: normalized,
    urls,
    updatedAt: new Date().toISOString(),
  };
  await writeDiscordImportsFile(file);
}