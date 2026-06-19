import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  BaseDirectory,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const SETTINGS_FILE = "gif-picker-settings.json";
const LIBRARY_FILE = "gif-picker-library.json";
const SESSION_FILE = "gif-picker-session.json";

export interface WatchedFolder {
  path: string;
  name: string;
}

export type SidebarView = "all" | "favorites" | "folder" | "tag";
export type MainView = "library" | "settings";

export interface AppSettings {
  includeVideos: boolean;
  gridCellMinWidth: number;
  retainLoadedThumbnails: boolean;
  staticThumbnails: boolean;
  previewOnHover: boolean;
  /** Thumbnail RAM budget in MB. 0 = unlimited. */
  thumbnailCacheLimitMb: number;
  /** Copy media to clipboard using a .gif filename (file copy, not bitmap). */
  copyAsGif: boolean;
  /** Show full folder path under each folder name in the sidebar. */
  showFolderPaths: boolean;
  /** Tags that blur matching items in the grid. */
  blurTags: string[];
}

export interface LibraryMeta {
  favorites: string[];
  tags: Record<string, string[]>;
  tagOrder: string[];
  /** Paths hidden from the library (files remain on disk). */
  excluded: string[];
  /** Per-file search labels (separate from grouping tags). */
  keywords: Record<string, string[]>;
}

export interface SessionState {
  sidebarView: SidebarView;
  selectedFolder: string | null;
  selectedTag: string | null;
  mainView: MainView;
  search: string;
}

interface PersistedLibrary extends LibraryMeta {
  folders: WatchedFolder[];
}

interface LibraryStore {
  settings: AppSettings;
  meta: LibraryMeta;
  folders: WatchedFolder[];
  session: SessionState;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateSession: (patch: Partial<SessionState>) => Promise<void>;
  setFolders: (folders: WatchedFolder[]) => Promise<void>;
  addFolder: (folder: WatchedFolder) => Promise<void>;
  updateFolderName: (path: string, name: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  createTag: (tag: string) => Promise<void>;
  addTag: (path: string, tag: string) => Promise<void>;
  removeTagFromItem: (path: string, tag: string) => Promise<void>;
  deleteTag: (tag: string) => Promise<void>;
  reorderTags: (fromIndex: number, toIndex: number) => Promise<void>;
  excludePath: (path: string) => Promise<void>;
  restoreExcluded: (path: string) => Promise<void>;
  addKeyword: (path: string, keyword: string) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  includeVideos: true,
  gridCellMinWidth: 140,
  retainLoadedThumbnails: true,
  staticThumbnails: true,
  previewOnHover: false,
  thumbnailCacheLimitMb: 128,
  copyAsGif: false,
  showFolderPaths: true,
  blurTags: [],
};

const DEFAULT_META: LibraryMeta = {
  favorites: [],
  tags: {},
  tagOrder: [],
  excluded: [],
  keywords: {},
};

const DEFAULT_SESSION: SessionState = {
  sidebarView: "all",
  selectedFolder: null,
  selectedTag: null,
  mainView: "library",
  search: "",
};

const DEFAULT_LIBRARY: PersistedLibrary = {
  folders: [],
  ...DEFAULT_META,
};

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    // directory already exists
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    await ensureAppDataDir();
    const raw = await readTextFile(file, { baseDir: BaseDirectory.AppData });
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(file: string, data: T): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(file, JSON.stringify(data, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  meta: DEFAULT_META,
  folders: [],
  session: DEFAULT_SESSION,
  hydrated: false,

  hydrate: async () => {
    try {
      const migrated = await invoke<number>("migrate_legacy_app_data");
      if (migrated > 0) {
        console.info(
          `[gif-picker] migrated ${migrated} config file(s) from a previous app data folder`,
        );
      }
    } catch (error) {
      console.warn("[gif-picker] legacy config migration skipped:", error);
    }

    const [settings, library, session] = await Promise.all([
      readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS),
      readJsonFile(LIBRARY_FILE, DEFAULT_LIBRARY),
      readJsonFile(SESSION_FILE, DEFAULT_SESSION),
    ]);

    let folders = (library.folders ?? []).map((folder) => ({
      ...folder,
      path: normalizeFolderPath(folder.path),
    }));

    const meta: LibraryMeta = {
      favorites: library.favorites ?? [],
      tags: library.tags ?? {},
      tagOrder: library.tagOrder ?? [],
      excluded: library.excluded ?? [],
      keywords: library.keywords ?? {},
    };

    if (folders.length === 0) {
      try {
        await ensureAppDataDir();
        const legacyRaw = await readTextFile("gif-picker-folders.json", {
          baseDir: BaseDirectory.AppData,
        });
        const legacy = JSON.parse(legacyRaw);
        if (Array.isArray(legacy) && legacy.length > 0) {
          folders = legacy.map((folder: WatchedFolder) => ({
            name: folder.name,
            path: normalizeFolderPath(folder.path),
          }));
          await writeJsonFile(LIBRARY_FILE, { ...meta, folders });
        }
      } catch {
        // no legacy file
      }
    }

    set({
      settings: { ...DEFAULT_SETTINGS, ...settings },
      meta,
      folders,
      session: { ...DEFAULT_SESSION, ...session },
      hydrated: true,
    });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await writeJsonFile(SETTINGS_FILE, settings);
  },

  updateSession: async (patch) => {
    const session = { ...get().session, ...patch };
    set({ session });
    await writeJsonFile(SESSION_FILE, session);
  },

  setFolders: async (folders) => {
    const normalized = folders.map((f) => ({
      ...f,
      path: normalizeFolderPath(f.path),
    }));
    set({ folders: normalized });
    const { meta } = get();
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: normalized });
  },

  addFolder: async (folder) => {
    const normalized = {
      ...folder,
      path: normalizeFolderPath(folder.path),
    };
    const folders = [...get().folders];
    if (folders.some((f) => f.path === normalized.path)) return;
    folders.push(normalized);
    await get().setFolders(folders);
  },

  updateFolderName: async (path, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const norm = normalizeFolderPath(path);
    const folders = get().folders.map((folder) =>
      folder.path === norm ? { ...folder, name: trimmed } : folder,
    );
    await get().setFolders(folders);
  },

  removeFolder: async (path) => {
    const norm = normalizeFolderPath(path);
    const folders = get().folders.filter((f) => f.path !== norm);
    await get().setFolders(folders);
  },

  toggleFavorite: async (path) => {
    const meta = structuredClone(get().meta);
    const index = meta.favorites.indexOf(path);
    if (index >= 0) {
      meta.favorites.splice(index, 1);
    } else {
      meta.favorites.unshift(path);
    }
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  createTag: async (rawTag) => {
    const tag = normalizeTag(rawTag);
    if (!tag) return;

    const meta = structuredClone(get().meta);
    if (meta.tagOrder.includes(tag)) return;

    meta.tagOrder.push(tag);
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  addTag: async (path, rawTag) => {
    const tag = normalizeTag(rawTag);
    if (!tag) return;

    const meta = structuredClone(get().meta);
    const existing = meta.tags[path] ?? [];
    if (!existing.includes(tag)) {
      meta.tags[path] = [...existing, tag];
    }
    if (!meta.tagOrder.includes(tag)) {
      meta.tagOrder.push(tag);
    }
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  removeTagFromItem: async (path, rawTag) => {
    const tag = normalizeTag(rawTag);
    const meta = structuredClone(get().meta);
    const existing = meta.tags[path] ?? [];
    if (!existing.includes(tag)) return;

    meta.tags[path] = existing.filter((value) => value !== tag);
    if (meta.tags[path].length === 0) {
      delete meta.tags[path];
    }
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  deleteTag: async (tag) => {
    const normalized = normalizeTag(tag);
    const meta = structuredClone(get().meta);
    for (const path of Object.keys(meta.tags)) {
      meta.tags[path] = meta.tags[path].filter((value) => value !== normalized);
      if (meta.tags[path].length === 0) {
        delete meta.tags[path];
      }
    }
    meta.tagOrder = meta.tagOrder.filter((value) => value !== normalized);
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });

    const { settings } = get();
    if (settings.blurTags.includes(normalized)) {
      await get().updateSettings({
        blurTags: settings.blurTags.filter((value) => value !== normalized),
      });
    }
  },

  reorderTags: async (fromIndex, toIndex) => {
    const meta = structuredClone(get().meta);
    const [moved] = meta.tagOrder.splice(fromIndex, 1);
    if (!moved) return;
    meta.tagOrder.splice(toIndex, 0, moved);
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  excludePath: async (path) => {
    const meta = structuredClone(get().meta);
    if (!meta.excluded.includes(path)) {
      meta.excluded.push(path);
    }
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  restoreExcluded: async (path) => {
    const meta = structuredClone(get().meta);
    meta.excluded = meta.excluded.filter((value) => value !== path);
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

  addKeyword: async (path, rawKeyword) => {
    const keyword = normalizeKeyword(rawKeyword);
    if (!keyword) return;

    const meta = structuredClone(get().meta);
    const existing = meta.keywords[path] ?? [];
    if (!existing.includes(keyword)) {
      meta.keywords[path] = [...existing, keyword];
    }
    set({ meta });
    await writeJsonFile(LIBRARY_FILE, { ...meta, folders: get().folders });
  },

}));