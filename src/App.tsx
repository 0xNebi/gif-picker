import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FolderPlus,
  X,
  Search,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings,
  Star,
  Tag,
  Film,
  ArrowLeft,
  EyeOff,
  Hash,
  Trash2,
  Pencil,
  Plus,
  Download,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";

import type { DirEntry } from "@tauri-apps/plugin-fs";

import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
import { DiscordImportDialog } from "./components/DiscordImportDialog";
import { FolderPathLabel } from "./components/FolderPathLabel";
import { TagAssignDialog } from "./components/TagAssignDialog";
import { MediaPreview } from "./components/MediaPreview";
import {
  SettingsView,
  type SettingsViewHandle,
} from "./components/SettingsView";
import { VirtualGifGrid } from "./components/VirtualGifGrid";
import { WindowControls } from "./components/WindowControls";
import { ActionButton } from "./components/ui/ActionButton";
import { Button } from "./components/ui/Button";
import { IconButton } from "./components/ui/IconButton";
import { InputDialog } from "./components/ui/InputDialog";
import { Toast } from "./components/ui/Toast";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  useLibraryStore,
  type SidebarView,
  type WatchedFolder,
} from "./store/useLibraryStore";
import { copyMediaToClipboard, copyPathToClipboard } from "./utils/clipboard";
import {
  clearThumbnailCache,
  setThumbnailMemoryBudgetMb,
} from "./utils/extractFirstFrame";
import {
  isGifPath,
  matchesMediaFilter,
  resolveMediaKind,
  type MediaFile,
} from "./utils/mediaTypes";
import { applyColorScheme } from "./utils/theme";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function getFolderName(path: string): string {
  const parts = normalizePath(path).split("/");
  return parts[parts.length - 1] || path;
}

function copyMediaToastMessage(
  path: string,
  kind: MediaFile["kind"],
  copyAsGif: boolean,
): string {
  if (copyAsGif && !isGifPath(path)) {
    return "Copied as .gif";
  }
  if (kind === "video") return "Video copied to clipboard";
  if (kind === "gif") return "GIF copied to clipboard";
  return "Image copied to clipboard";
}

function menuIcon(icon: React.ReactNode) {
  return <span className="menu-icon">{icon}</span>;
}

async function collectMediaRecursive(
  dirPath: string,
  includeVideos: boolean,
): Promise<string[]> {
  const results: string[] = [];
  const root = normalizePath(dirPath);

  async function walk(current: string) {
    let entries: DirEntry[] = [];
    try {
      entries = await readDir(current);
    } catch (e) {
      console.warn("[gif-picker] readDir failed for", current, e);
      return;
    }

    for (const entry of entries) {
      const fullPath = `${current}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory) {
        await walk(fullPath);
      } else if (entry.isFile && matchesMediaFilter(entry.name, includeVideos)) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results;
}

async function revealInExplorer(path: string) {
  try {
    await invoke("reveal_in_explorer", { path });
  } catch (e) {
    console.error("reveal failed", e);
    const parent = path.replace(/[\\/][^\\/]+$/, "");
    await invoke("reveal_in_explorer", { path: parent });
  }
}

export function App() {
  const {
    settings,
    meta,
    folders,
    session,
    hydrated,
    hydrate,
    updateSettings,
    updateSession,
    addFolder: persistAddFolder,
    updateFolderName,
    removeFolder: persistRemoveFolder,
    toggleFavorite,
    createTag,
    addTag,
    removeTagFromItem,
    deleteTag,
    reorderTags,
    excludePath,
    excludePaths,
    restoreExcluded,
    restoreExcludedPaths,
    addKeyword,
  } = useLibraryStore();

  const { sidebarView, selectedFolder, selectedTag, mainView, search } = session;

  const [media, setMedia] = useState<MediaFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<MediaFile | null>(null);
  const [status, setStatus] = useState("Ready");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [draggingTagIndex, setDraggingTagIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tagAssignPath, setTagAssignPath] = useState<string | null>(null);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [keywordPromptPath, setKeywordPromptPath] = useState<string | null>(null);
  const [folderRenamePath, setFolderRenamePath] = useState<string | null>(null);
  const [discordImportOpen, setDiscordImportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<SettingsViewHandle>(null);
  const hoveredMediaRef = useRef<MediaFile | null>(null);
  const updater = useAppUpdater();
  const startupUpdateCheckedRef = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    setThumbnailMemoryBudgetMb(settings.thumbnailCacheLimitMb);
  }, [hydrated, settings.thumbnailCacheLimitMb]);

  useEffect(() => {
    if (!hydrated) return;
    applyColorScheme(settings.colorScheme);
  }, [hydrated, settings.colorScheme]);

  useEffect(() => {
    if (!hydrated || !settings.autoCheckUpdates || startupUpdateCheckedRef.current) {
      return;
    }
    startupUpdateCheckedRef.current = true;
    void updater.checkForUpdates({ autoInstall: settings.autoInstallUpdates });
  }, [
    hydrated,
    settings.autoCheckUpdates,
    settings.autoInstallUpdates,
    updater.checkForUpdates,
  ]);

  useEffect(() => {
    const preventNativeMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("contextmenu", preventNativeMenu);
    return () => document.removeEventListener("contextmenu", preventNativeMenu);
  }, []);

  const scanAllFolders = useCallback(async () => {
    if (folders.length === 0) {
      setMedia([]);
      setStatus("Ready");
      return;
    }

    setIsLoading(true);
    setStatus("Scanning folders...");
    clearThumbnailCache();
    const byPath = new Map<string, MediaFile>();

    for (const folder of folders) {
      try {
        const files = await collectMediaRecursive(
          folder.path,
          settings.includeVideos,
        );
        const folderPath = normalizePath(folder.path);
        for (const f of files) {
          const path = normalizePath(f);
          const kind = await resolveMediaKind(path);
          if (!kind) continue;

          const item: MediaFile = {
            path,
            name: f.split("/").pop() || f,
            folderPath,
            kind,
          };
          const existing = byPath.get(path);
          // Overlapping watched folders can discover the same file twice.
          if (!existing || folderPath.length > existing.folderPath.length) {
            byPath.set(path, item);
          }
        }
      } catch (e) {
        console.warn("scan error for", folder.path, e);
      }
    }

    const all = Array.from(byPath.values());
    all.sort((a, b) => a.name.localeCompare(b.name));
    setMedia(all);
    setStatus(`${all.length} items from ${folders.length} folders`);
    setIsLoading(false);
  }, [folders, settings.includeVideos]);

  useEffect(() => {
    if (!hydrated) return;
    void scanAllFolders();
  }, [hydrated, scanAllFolders]);

  async function addFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder containing GIFs or videos",
    });

    if (!selected || typeof selected !== "string") return;

    const normalized = normalizePath(selected);
    if (folders.some((f) => f.path === normalized)) {
      setStatus("Folder already added");
      return;
    }

    await persistAddFolder({
      path: normalized,
      name: getFolderName(selected),
    });
    await updateSession({
      sidebarView: "folder",
      selectedFolder: normalized,
      selectedTag: null,
      mainView: "library",
    });
    setStatus("Added folder. Scanning...");
  }

  async function removeFolder(pathToRemove: string) {
    const norm = normalizePath(pathToRemove);
    await persistRemoveFolder(norm);
    if (selectedFolder === norm) {
      await updateSession({
        selectedFolder: null,
        sidebarView: "all",
      });
    }
  }

  const favoriteSet = useMemo(() => new Set(meta.favorites), [meta.favorites]);
  const blurTagSet = useMemo(() => new Set(settings.blurTags), [settings.blurTags]);
  const excludedSet = useMemo(() => new Set(meta.excluded), [meta.excluded]);

  const visibleMedia = useMemo(
    () => media.filter((item) => !excludedSet.has(item.path)),
    [media, excludedSet],
  );

  const libraryPathsByFolder = useMemo(() => {
    const byFolder = new Map<string, string[]>();
    for (const item of visibleMedia) {
      const list = byFolder.get(item.folderPath) ?? [];
      list.push(item.path);
      byFolder.set(item.folderPath, list);
    }
    return byFolder;
  }, [visibleMedia]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of visibleMedia) {
      counts.set(item.folderPath, (counts.get(item.folderPath) ?? 0) + 1);
    }
    return counts;
  }, [visibleMedia]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [path, tags] of Object.entries(meta.tags)) {
      if (excludedSet.has(path)) continue;
      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }, [meta.tags, excludedSet]);

  const filteredMedia = useMemo(() => {
    let result = visibleMedia;

    if (sidebarView === "favorites") {
      result = result.filter((item) => favoriteSet.has(item.path));
    } else if (sidebarView === "folder" && selectedFolder) {
      result = result.filter((item) => item.folderPath === selectedFolder);
    } else if (sidebarView === "tag" && selectedTag) {
      result = result.filter((item) =>
        (meta.tags[item.path] ?? []).includes(selectedTag),
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const tagMatch = (meta.tags[item.path] ?? []).some((tag) =>
          tag.includes(q),
        );
        const keywordMatch = (meta.keywords[item.path] ?? []).some((keyword) =>
          keyword.includes(q),
        );
        return nameMatch || tagMatch || keywordMatch;
      });
    }

    return result;
  }, [
    visibleMedia,
    sidebarView,
    selectedFolder,
    selectedTag,
    search,
    favoriteSet,
    excludedSet,
    meta.tags,
    meta.keywords,
  ]);

  const gridResetKey = `${sidebarView}:${selectedFolder ?? ""}:${selectedTag ?? ""}:${search}`;
  const showFilterEmpty =
    media.length > 0 && filteredMedia.length === 0 && !isLoading;

  const maxRetainedRows = useMemo(() => {
    if (!settings.retainLoadedThumbnails) return 24;
    const mb =
      settings.thumbnailCacheLimitMb > 0 ? settings.thumbnailCacheLimitMb : 256;
    return Math.min(100, Math.max(24, Math.floor(mb / 2)));
  }, [settings.retainLoadedThumbnails, settings.thumbnailCacheLimitMb]);

  const handleEscape = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (tagAssignPath) {
      setTagAssignPath(null);
      return;
    }
    if (createTagOpen) {
      setCreateTagOpen(false);
      return;
    }
    if (keywordPromptPath) {
      setKeywordPromptPath(null);
      return;
    }
    if (folderRenamePath) {
      setFolderRenamePath(null);
      return;
    }
    if (discordImportOpen) {
      setDiscordImportOpen(false);
      return;
    }
    if (preview) {
      setPreview(null);
      return;
    }
    if (mainView === "settings") {
      if (settingsRef.current?.closeDetailPanel()) return;
      void updateSession({ mainView: "library" });
    }
  }, [
    contextMenu,
    discordImportOpen,
    folderRenamePath,
    mainView,
    preview,
    tagAssignPath,
    createTagOpen,
    keywordPromptPath,
    updateSession,
  ]);

  const handleHoverChange = useCallback((item: MediaFile | null) => {
    hoveredMediaRef.current = item;
  }, []);

  const focusSearch = useCallback(() => {
    if (mainView !== "library") {
      void updateSession({ mainView: "library" });
    }
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
  }, [mainView, updateSession]);

  const showToast = useCallback(
    (message: string) => {
      setToast(message);
      setStatus(message);
      window.setTimeout(() => {
        setStatus(`${filteredMedia.length} items`);
      }, 2400);
    },
    [filteredMedia.length],
  );

  const copyHoveredMedia = useCallback(() => {
    if (
      mainView !== "library" ||
      preview ||
      contextMenu ||
      tagAssignPath ||
      createTagOpen ||
      keywordPromptPath ||
      folderRenamePath ||
      discordImportOpen
    ) {
      return false;
    }

    const item = hoveredMediaRef.current;
    if (!item) return false;

    void copyMediaToClipboard(item.path, { asGif: settings.copyAsGif }).then(() => {
      showToast(copyMediaToastMessage(item.path, item.kind, settings.copyAsGif));
    });
    return true;
  }, [
    contextMenu,
    discordImportOpen,
    folderRenamePath,
    keywordPromptPath,
    mainView,
    preview,
    settings.copyAsGif,
    showToast,
    tagAssignPath,
    createTagOpen,
  ]);

  const excludeHoveredMedia = useCallback(() => {
    if (
      mainView !== "library" ||
      preview ||
      contextMenu ||
      tagAssignPath ||
      createTagOpen ||
      keywordPromptPath ||
      folderRenamePath ||
      discordImportOpen
    ) {
      return false;
    }

    const item = hoveredMediaRef.current;
    if (!item) return false;

    void excludePath(item.path).then(() => {
      hoveredMediaRef.current = null;
      showToast("Excluded from library");
    });
    return true;
  }, [
    contextMenu,
    discordImportOpen,
    excludePath,
    folderRenamePath,
    keywordPromptPath,
    mainView,
    preview,
    showToast,
    tagAssignPath,
    createTagOpen,
  ]);

  useKeyboardShortcuts({
    onFocusSearch: focusSearch,
    onCopy: copyHoveredMedia,
    onExclude: excludeHoveredMedia,
    onEscape: handleEscape,
  });

  const openSettings = useCallback(() => {
    void updateSession({ mainView: "settings" });
  }, [updateSession]);

  const goToLibrary = useCallback(() => {
    void updateSession({ mainView: "library" });
  }, [updateSession]);

  const handleDiscordImportComplete = useCallback(
    async (destDir: string) => {
      const normalized = normalizePath(destDir);
      if (!folders.some((folder) => folder.path === normalized)) {
        await persistAddFolder({
          path: normalized,
          name: getFolderName(destDir),
        });
      }
      await updateSession({
        sidebarView: "folder",
        selectedFolder: normalized,
        selectedTag: null,
        mainView: "library",
      });
      setStatus("Added Discord GIFs. Scanning...");
    },
    [folders, persistAddFolder, updateSession],
  );

  const buildMediaMenu = useCallback(
    (item: MediaFile): ContextMenuItem[] => {
      const isFavorite = favoriteSet.has(item.path);
      const copyLabel =
        item.kind === "video"
          ? "Copy video file"
          : item.kind === "gif"
            ? "Copy GIF"
            : "Copy image";
      return [
        {
          id: "preview",
          label: "Open preview",
          onClick: () => setPreview(item),
        },
        {
          id: "copy-media",
          label: copyLabel,
          icon: menuIcon(<Copy size={15} strokeWidth={1.5} />),
          onClick: () => {
            void copyMediaToClipboard(item.path, { asGif: settings.copyAsGif }).then(
              () => {
                showToast(
                  copyMediaToastMessage(item.path, item.kind, settings.copyAsGif),
                );
              },
            );
          },
        },
        {
          id: "copy-path",
          label: "Copy file path",
          icon: menuIcon(<Copy size={15} strokeWidth={1.5} />),
          onClick: () => {
            void copyPathToClipboard(item.path).then(() => {
              showToast("Path copied to clipboard");
            });
          },
        },
        {
          id: "favorite",
          label: isFavorite ? "Remove from favorites" : "Add to favorites",
          icon: menuIcon(<Star size={15} strokeWidth={1.5} />),
          onClick: () => {
            void toggleFavorite(item.path);
          },
        },
        {
          id: "tag",
          label: "Add tag…",
          icon: menuIcon(<Tag size={15} strokeWidth={1.5} />),
          onClick: () => setTagAssignPath(item.path),
        },
        {
          id: "keyword",
          label: "Add keyword…",
          icon: menuIcon(<Hash size={15} strokeWidth={1.5} />),
          onClick: () => setKeywordPromptPath(item.path),
        },
        {
          id: "exclude",
          label: "Exclude from library",
          icon: menuIcon(<EyeOff size={15} strokeWidth={1.5} />),
          onClick: () => {
            void excludePath(item.path).then(() => {
              if (preview?.path === item.path) setPreview(null);
              showToast("Excluded from library");
            });
          },
        },
        {
          id: "reveal",
          label: "Reveal in Explorer",
          icon: menuIcon(<ExternalLink size={15} strokeWidth={1.5} />),
          onClick: () => {
            void revealInExplorer(item.path);
          },
        },
        {
          id: "settings",
          label: "Settings",
          icon: menuIcon(<Settings size={15} strokeWidth={1.5} />),
          onClick: openSettings,
        },
      ];
    },
    [
      excludePath,
      favoriteSet,
      openSettings,
      preview?.path,
      settings.copyAsGif,
      showToast,
      toggleFavorite,
    ],
  );

  const buildFolderMenu = useCallback(
    (folder: WatchedFolder): ContextMenuItem[] => [
      {
        id: "folder-properties",
        label: "Properties",
        icon: menuIcon(<Pencil size={15} strokeWidth={1.5} />),
        onClick: () => setFolderRenamePath(folder.path),
      },
      {
        id: "reveal-folder",
        label: "Reveal in Explorer",
        icon: menuIcon(<ExternalLink size={15} strokeWidth={1.5} />),
        onClick: () => {
          void revealInExplorer(folder.path);
        },
      },
      {
        id: "remove-folder",
        label: "Remove folder",
        icon: menuIcon(<X size={15} strokeWidth={1.5} />),
        danger: true,
        onClick: () => {
          void removeFolder(folder.path);
        },
      },
    ],
    [removeFolder],
  );

  const buildTagMenu = useCallback(
    (tag: string): ContextMenuItem[] => [
      {
        id: "delete-tag",
        label: "Delete tag",
        icon: menuIcon(<Trash2 size={15} strokeWidth={1.5} />),
        onClick: () => {
          void deleteTag(tag).then(() => {
            if (selectedTag === tag) {
              void updateSession({
                sidebarView: "all",
                selectedTag: null,
              });
            }
            showToast(`Deleted tag “${tag}”`);
          });
        },
      },
    ],
    [deleteTag, selectedTag, showToast, updateSession],
  );

  const showBlankContextMenu = useCallback(
    (x: number, y: number) => {
      setContextMenu({
        x,
        y,
        items: [
          {
            id: "add-folder",
            label: "Add folder",
            icon: menuIcon(<FolderPlus size={15} strokeWidth={1.5} />),
            onClick: () => {
              void addFolder();
            },
          },
          {
            id: "create-tag",
            label: "Create tag",
            icon: menuIcon(<Tag size={15} strokeWidth={1.5} />),
            onClick: () => setCreateTagOpen(true),
          },
          {
            id: "refresh",
            label: "Rescan all",
            icon: menuIcon(<RefreshCw size={15} strokeWidth={1.5} />),
            onClick: () => {
              void scanAllFolders();
            },
          },
          {
            id: "settings",
            label: "Settings",
            icon: menuIcon(<Settings size={15} strokeWidth={1.5} />),
            onClick: openSettings,
          },
        ],
      });
    },
    [openSettings, scanAllFolders],
  );

  function updateSidebar(patch: {
    sidebarView?: SidebarView;
    selectedFolder?: string | null;
    selectedTag?: string | null;
  }) {
    void updateSession({ ...patch, mainView: "library" });
  }

  function selectAll() {
    updateSidebar({
      sidebarView: "all",
      selectedFolder: null,
      selectedTag: null,
    });
  }

  function selectFavorites() {
    updateSidebar({
      sidebarView: "favorites",
      selectedFolder: null,
      selectedTag: null,
    });
  }

  function selectFolder(path: string) {
    updateSidebar({
      sidebarView: "folder",
      selectedFolder: normalizePath(path),
      selectedTag: null,
    });
  }

  function selectTag(tag: string) {
    updateSidebar({
      sidebarView: "tag",
      selectedTag: tag,
      selectedFolder: null,
    });
  }

  const title =
    mainView === "settings"
      ? "Settings"
      : sidebarView === "favorites"
        ? "Favorites"
        : sidebarView === "tag" && selectedTag
          ? `#${selectedTag}`
          : sidebarView === "folder" && selectedFolder
            ? folders.find((f) => f.path === selectedFolder)?.name || "Folder"
            : "All media";

  return (
    <div className="app-shell">
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <div className="app-mark">
            <img
              className="app-mark__icon"
              src="/app-icon.svg"
              alt=""
              aria-hidden
              draggable={false}
            />
            <span className="app-name">GIF Picker</span>
          </div>
          <span className="titlebar-sep">·</span>
          <span className="titlebar-subtitle">{title}</span>
        </div>
        <WindowControls />
      </div>

      <div className="main-layout">
        <div
          className="sidebar"
          onContextMenu={(e) => {
            e.preventDefault();
            showBlankContextMenu(e.clientX, e.clientY);
          }}
        >
          <div className="sidebar-header">
            <span>Library</span>
            <IconButton
              size="sm"
              label="Add folder"
              onClick={() => void addFolder()}
            >
              <FolderPlus size={16} strokeWidth={1.5} />
            </IconButton>
          </div>

          <div className="sidebar-content">
            <div
              className={`nav-item ${sidebarView === "all" && mainView === "library" ? "active" : ""}`}
              onClick={selectAll}
            >
              <span>All media</span>
              <span className="nav-count">{visibleMedia.length}</span>
            </div>

            <div
              className={`nav-item ${sidebarView === "favorites" && mainView === "library" ? "active" : ""}`}
              onClick={selectFavorites}
            >
              <span className="nav-item-label">
                <Star size={14} strokeWidth={1.5} /> Favorites
              </span>
              <span className="nav-count">{meta.favorites.length}</span>
            </div>

            {folders.length > 0 && (
              <div className="sidebar-section-label">Folders</div>
            )}

            {folders.map((folder) => (
              <div
                key={folder.path}
                className={`nav-item nav-item--folder${
                  settings.showFolderPaths ? "" : " nav-item--folder-compact"
                } ${
                  sidebarView === "folder" &&
                  selectedFolder === folder.path &&
                  mainView === "library"
                    ? "active"
                    : ""
                }`}
                onClick={() => selectFolder(folder.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: buildFolderMenu(folder),
                  });
                }}
              >
                <div className="nav-item-body">
                  <div className="folder-name">{folder.name}</div>
                  {settings.showFolderPaths && (
                    <FolderPathLabel path={folder.path} />
                  )}
                </div>
                <div className="nav-item-actions">
                  <span className="nav-count">
                    {folderCounts.get(folder.path) ?? 0}
                  </span>
                  <button
                    type="button"
                    className="folder-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeFolder(folder.path);
                    }}
                    aria-label="Remove folder"
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}

            <div className="sidebar-section-header">
              <span className="sidebar-section-label">Tags</span>
              <IconButton
                size="sm"
                label="Create tag"
                onClick={() => setCreateTagOpen(true)}
              >
                <Plus size={14} strokeWidth={1.5} />
              </IconButton>
            </div>

            {meta.tagOrder.map((tag, index) => (
              <div
                key={tag}
                className={`nav-item tag-item ${
                  sidebarView === "tag" && selectedTag === tag && mainView === "library"
                    ? "active"
                    : ""
                } ${draggingTagIndex === index ? "dragging" : ""}`}
                draggable
                onDragStart={() => setDraggingTagIndex(index)}
                onDragEnd={() => setDraggingTagIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingTagIndex !== null && draggingTagIndex !== index) {
                    void reorderTags(draggingTagIndex, index);
                  }
                  setDraggingTagIndex(null);
                  const path = e.dataTransfer.getData("text/media-path");
                  if (path) void addTag(path, tag);
                }}
                onClick={() => selectTag(tag)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: buildTagMenu(tag),
                  });
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add("drop-target");
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove("drop-target");
                }}
              >
                <span className="nav-item-label">
                  <Tag size={14} strokeWidth={1.5} /> {tag}
                </span>
                <span className="nav-count">{tagCounts.get(tag) ?? 0}</span>
              </div>
            ))}

            {folders.length === 0 && (
              <div className="sidebar-hint">
                Add a folder with GIFs or looped videos to get started.
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <Button
              variant="secondary"
              size="md"
              fullWidth
              icon={<RefreshCw size={14} strokeWidth={1.5} />}
              onClick={() => void scanAllFolders()}
            >
              Rescan all
            </Button>
            <Button
              variant={mainView === "settings" ? "secondary" : "ghost"}
              size="md"
              fullWidth
              icon={<Settings size={14} strokeWidth={1.5} />}
              onClick={openSettings}
            >
              Settings
            </Button>
          </div>
        </div>

        <div className="content">
          <div className="content-panes">
            <div
              className={`content-pane ${
                mainView === "library" ? "is-active" : "is-cached"
              }`}
            >
              <div className="toolbar">
                <div className="toolbar-search">
                  <Search size={16} strokeWidth={1.5} />
                  <input
                    ref={searchRef}
                    className="search-input"
                    placeholder="Search by name, tag, or keyword…"
                    value={search}
                    onChange={(e) => {
                      void updateSession({ search: e.target.value });
                    }}
                  />
                </div>
                <div className="toolbar-actions">
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<Download size={15} strokeWidth={1.5} />}
                    onClick={() => setDiscordImportOpen(true)}
                  >
                    Discord
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<FolderPlus size={15} strokeWidth={1.5} />}
                    onClick={() => void addFolder()}
                  >
                    Add folder
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    icon={
                      <RefreshCw
                        size={15}
                        strokeWidth={1.5}
                        className={isLoading ? "spin" : ""}
                      />
                    }
                    onClick={() => void scanAllFolders()}
                    disabled={isLoading}
                  >
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="library-stack">
                {media.length === 0 && !isLoading ? (
                  <div className="empty-state">
                    <div className="empty-state__icon">
                      <Film size={24} strokeWidth={1.5} />
                    </div>
                    <h3>No media found</h3>
                    <p>Add a folder with GIFs or videos to begin.</p>
                    <Button
                      variant="primary"
                      size="md"
                      icon={<FolderPlus size={15} strokeWidth={1.5} />}
                      onClick={() => void addFolder()}
                    >
                      Add media folder
                    </Button>
                  </div>
                ) : (
                  <>
                    {showFilterEmpty && mainView === "library" && (
                      <div className="empty-state empty-state--overlay">
                        <h3>No matches</h3>
                        <p>Try another filter, tag, or search term.</p>
                      </div>
                    )}
                    {media.length > 0 && (
                      <VirtualGifGrid
                        gifs={filteredMedia}
                        resetKey={gridResetKey}
                        minColumnWidth={settings.gridCellMinWidth}
                        retainLoadedRows={settings.retainLoadedThumbnails}
                        maxRetainedRows={maxRetainedRows}
                        staticThumbnails={settings.staticThumbnails}
                        previewOnHover={settings.previewOnHover}
                        favoritePaths={favoriteSet}
                        blurTags={blurTagSet}
                        tagsByPath={meta.tags}
                        onSelect={setPreview}
                        onContextMenu={(item, x, y) => {
                          setContextMenu({
                            x,
                            y,
                            items: buildMediaMenu(item),
                          });
                        }}
                        onHoverChange={handleHoverChange}
                      />
                    )}
                  </>
                )}
              </div>

              <div className="status-bar">
                {isLoading ? "Scanning…" : status}
                {search && ` · filtered by “${search}”`}
              </div>
            </div>

            <div
              className={`content-pane ${
                mainView === "settings" ? "is-active" : "is-cached"
              }`}
            >
              <div className="toolbar">
                <Button
                  variant="ghost"
                  size="md"
                  icon={<ArrowLeft size={15} strokeWidth={1.5} />}
                  onClick={goToLibrary}
                >
                  Back
                </Button>
                <span className="toolbar-title">Settings</span>
              </div>

              <SettingsView
                ref={settingsRef}
                settings={settings}
                updater={updater}
                folders={folders}
                excludedPaths={meta.excluded}
                excludedPathSet={excludedSet}
                tagOrder={meta.tagOrder}
                libraryPathsByFolder={libraryPathsByFolder}
                onOpenDiscordImport={() => setDiscordImportOpen(true)}
                onChange={(patch) => void updateSettings(patch)}
                onRestoreExcluded={(path) => {
                  void restoreExcluded(path);
                  showToast("Restored to library");
                }}
                onRestoreExcludedPaths={(paths) => {
                  void restoreExcludedPaths(paths).then(() => {
                    showToast(
                      paths.length === 1
                        ? "Restored 1 file to library"
                        : `Restored ${paths.length} files to library`,
                    );
                  });
                }}
                onExcludePath={(path) => {
                  void excludePath(path).then(() => {
                    showToast("Excluded from library");
                  });
                }}
                onExcludePaths={(paths) => {
                  void excludePaths(paths).then(() => {
                    showToast(
                      paths.length === 1
                        ? "Excluded 1 duplicate"
                        : `Excluded ${paths.length} duplicates`,
                    );
                  });
                }}
              />

              <div className="status-bar">Changes save automatically</div>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <IconButton
              size="md"
              label="Close preview"
              className="modal-close"
              onClick={() => setPreview(null)}
            >
              <X size={18} strokeWidth={1.5} />
            </IconButton>

            <div className="modal-preview-body">
              <MediaPreview
                path={preview.path}
                alt={preview.name}
                className="preview-media"
              />
            </div>

            <div className="modal-meta">
              <div className="modal-filename">{preview.name}</div>
              {((meta.tags[preview.path] ?? []).length > 0 ||
                (meta.keywords[preview.path] ?? []).length > 0) && (
                <div className="modal-tags">
                  {(meta.tags[preview.path] ?? []).map((tag) => (
                    <span key={tag} className="tag-chip">
                      #{tag}
                    </span>
                  ))}
                  {(meta.keywords[preview.path] ?? []).map((keyword) => (
                    <span key={keyword} className="keyword-chip">
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <ActionButton
                variant="primary"
                icon={<Copy size={14} strokeWidth={1.5} />}
                onAction={async () => {
                  await copyMediaToClipboard(preview.path, {
                    asGif: settings.copyAsGif,
                  });
                  showToast(
                    copyMediaToastMessage(
                      preview.path,
                      preview.kind,
                      settings.copyAsGif,
                    ),
                  );
                }}
              >
                {preview.kind === "video"
                  ? "Copy video"
                  : preview.kind === "gif"
                    ? "Copy GIF"
                    : "Copy image"}
              </ActionButton>
              <ActionButton
                icon={<Copy size={14} strokeWidth={1.5} />}
                onAction={async () => {
                  await copyPathToClipboard(preview.path);
                  showToast("Path copied to clipboard");
                }}
              >
                Copy path
              </ActionButton>
              <Button
                variant="secondary"
                size="md"
                icon={<ExternalLink size={14} strokeWidth={1.5} />}
                onClick={() => void revealInExplorer(preview.path)}
              >
                Reveal in Explorer
              </Button>
              <Button
                variant="ghost"
                size="md"
                className={
                  favoriteSet.has(preview.path) ? "modal-favorite-btn is-active" : ""
                }
                icon={
                  <Star
                    size={14}
                    strokeWidth={1.5}
                    fill={favoriteSet.has(preview.path) ? "currentColor" : "none"}
                  />
                }
                onClick={() => void toggleFavorite(preview.path)}
              >
                {favoriteSet.has(preview.path) ? "Unfavorite" : "Favorite"}
              </Button>
            </div>

            <div className="modal-path">{preview.path}</div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      <TagAssignDialog
        open={tagAssignPath !== null}
        mediaName={
          tagAssignPath
            ? media.find((item) => item.path === tagAssignPath)?.name
            : undefined
        }
        allTags={meta.tagOrder}
        assignedTags={
          tagAssignPath ? (meta.tags[tagAssignPath] ?? []) : []
        }
        onToggleTag={(tag) => {
          if (!tagAssignPath) return;
          const assigned = meta.tags[tagAssignPath] ?? [];
          if (assigned.includes(tag)) {
            void removeTagFromItem(tagAssignPath, tag);
          } else {
            void addTag(tagAssignPath, tag);
          }
        }}
        onCreateTag={(tag) => {
          if (!tagAssignPath) return;
          void addTag(tagAssignPath, tag);
        }}
        onClose={() => setTagAssignPath(null)}
      />

      <InputDialog
        open={createTagOpen}
        title="Create tag"
        label="Tag name"
        placeholder="e.g. reactions, memes, work"
        submitLabel="Create tag"
        onSubmit={(tag) => {
          void createTag(tag).then(() => showToast(`Created tag “${tag}”`));
        }}
        onClose={() => setCreateTagOpen(false)}
      />

      <InputDialog
        open={keywordPromptPath !== null}
        title="Add keyword"
        label="Keyword"
        placeholder="e.g. wave, laugh, thumbs up"
        submitLabel="Add keyword"
        onSubmit={(keyword) => {
          if (keywordPromptPath) void addKeyword(keywordPromptPath, keyword);
        }}
        onClose={() => setKeywordPromptPath(null)}
      />

      <InputDialog
        open={folderRenamePath !== null}
        title="Folder properties"
        description={folderRenamePath ?? undefined}
        label="Display name"
        placeholder="Folder name"
        initialValue={
          folders.find((folder) => folder.path === folderRenamePath)?.name ?? ""
        }
        submitLabel="Save"
        onSubmit={(name) => {
          if (!folderRenamePath) return;
          void updateFolderName(folderRenamePath, name).then(() => {
            showToast("Folder renamed");
          });
        }}
        onClose={() => setFolderRenamePath(null)}
      />

      <DiscordImportDialog
        open={discordImportOpen}
        onClose={() => setDiscordImportOpen(false)}
        onComplete={(destDir) => void handleDiscordImportComplete(destDir)}
        showToast={showToast}
      />

      <Toast message={toast} onClear={() => setToast(null)} />
    </div>
  );
}