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
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";

import type { DirEntry } from "@tauri-apps/plugin-fs";

import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
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
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  useLibraryStore,
  type SidebarView,
} from "./store/useLibraryStore";
import { copyMediaToClipboard, copyPathToClipboard } from "./utils/clipboard";
import {
  clearThumbnailCache,
  setThumbnailMemoryBudgetMb,
} from "./utils/extractFirstFrame";
import {
  getMediaKind,
  matchesMediaFilter,
  type MediaFile,
} from "./utils/mediaTypes";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function getFolderName(path: string): string {
  const parts = normalizePath(path).split("/");
  return parts[parts.length - 1] || path;
}

function isGifPath(path: string): boolean {
  return normalizePath(path).toLowerCase().endsWith(".gif");
}

function copyMediaToastMessage(
  path: string,
  kind: MediaFile["kind"],
  copyAsGif: boolean,
): string {
  if (copyAsGif && !isGifPath(path)) {
    return "Copied as .gif";
  }
  return kind === "video"
    ? "Video copied to clipboard"
    : "Image copied to clipboard";
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
    removeFolder: persistRemoveFolder,
    toggleFavorite,
    addTag,
    deleteTag,
    reorderTags,
    excludePath,
    restoreExcluded,
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
  const [tagPromptPath, setTagPromptPath] = useState<string | null>(null);
  const [keywordPromptPath, setKeywordPromptPath] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<SettingsViewHandle>(null);
  const hoveredMediaRef = useRef<MediaFile | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    setThumbnailMemoryBudgetMb(settings.thumbnailCacheLimitMb);
  }, [hydrated, settings.thumbnailCacheLimitMb]);

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
    const all: MediaFile[] = [];

    for (const folder of folders) {
      try {
        const files = await collectMediaRecursive(
          folder.path,
          settings.includeVideos,
        );
        for (const f of files) {
          const path = normalizePath(f);
          const kind = getMediaKind(path);
          if (!kind) continue;
          all.push({
            path,
            name: f.split("/").pop() || f,
            folderPath: normalizePath(folder.path),
            kind,
          });
        }
      } catch (e) {
        console.warn("scan error for", folder.path, e);
      }
    }

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
  const excludedSet = useMemo(() => new Set(meta.excluded), [meta.excluded]);

  const visibleMedia = useMemo(
    () => media.filter((item) => !excludedSet.has(item.path)),
    [media, excludedSet],
  );

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
    if (tagPromptPath) {
      setTagPromptPath(null);
      return;
    }
    if (keywordPromptPath) {
      setKeywordPromptPath(null);
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
  }, [contextMenu, mainView, preview, tagPromptPath, keywordPromptPath, updateSession]);

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
      tagPromptPath ||
      keywordPromptPath
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
    keywordPromptPath,
    mainView,
    preview,
    settings.copyAsGif,
    showToast,
    tagPromptPath,
  ]);

  useKeyboardShortcuts({
    onFocusSearch: focusSearch,
    onCopy: copyHoveredMedia,
    onEscape: handleEscape,
  });

  const openSettings = useCallback(() => {
    void updateSession({ mainView: "settings" });
  }, [updateSession]);

  const goToLibrary = useCallback(() => {
    void updateSession({ mainView: "library" });
  }, [updateSession]);

  const buildMediaMenu = useCallback(
    (item: MediaFile): ContextMenuItem[] => {
      const isFavorite = favoriteSet.has(item.path);
      const isVideo = item.kind === "video";
      return [
        {
          id: "preview",
          label: "Open preview",
          onClick: () => setPreview(item),
        },
        {
          id: "copy-media",
          label: isVideo ? "Copy video file" : "Copy image",
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
          onClick: () => setTagPromptPath(item.path),
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
                className={`nav-item ${
                  sidebarView === "folder" &&
                  selectedFolder === folder.path &&
                  mainView === "library"
                    ? "active"
                    : ""
                }`}
                onClick={() => selectFolder(folder.path)}
              >
                <div className="nav-item-body">
                  <div>{folder.name}</div>
                  <div className="folder-path">{folder.path}</div>
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

            {meta.tagOrder.length > 0 && (
              <div className="sidebar-section-label">Tags</div>
            )}

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
                excludedPaths={meta.excluded}
                onChange={(patch) => void updateSettings(patch)}
                onRestoreExcluded={(path) => {
                  void restoreExcluded(path);
                  showToast("Restored to library");
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
                {preview.kind === "video" ? "Copy video" : "Copy image"}
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

      <InputDialog
        open={tagPromptPath !== null}
        title="Add tag"
        label="Tag name"
        placeholder="e.g. reactions, memes, work"
        submitLabel="Add tag"
        onSubmit={(tag) => {
          if (tagPromptPath) void addTag(tagPromptPath, tag);
        }}
        onClose={() => setTagPromptPath(null)}
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

      <Toast message={toast} onClear={() => setToast(null)} />
    </div>
  );
}