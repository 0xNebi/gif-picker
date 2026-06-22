import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  FolderOpen,
  Github,
  RefreshCw,
  X,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { SettingsPreviewPane } from "./SettingsPreviewPane";
import { Slider } from "./ui/Slider";
import { Toggle } from "./ui/Toggle";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { OptionList } from "./ui/OptionList";
import { Select, type SelectOption } from "./ui/Select";
import type { AppSettings, WatchedFolder } from "../store/useLibraryStore";
import {
  duplicateScanProgressLabel,
  duplicateScanProgressPercent,
  findDuplicateFiles,
  formatFileSize,
  pathsToExcludeFromDuplicateGroups,
  type DuplicateFileGroup,
  type DuplicateScanProgress,
} from "../utils/duplicates";
import {
  copyNameToClipboard,
  copyPathToClipboard,
  fileNameFromPath,
} from "../utils/clipboard";
import {
  GITHUB_AUTHOR,
  GITHUB_AVATAR_URL,
  GITHUB_PROFILE_URL,
  GITHUB_REPO_URL,
} from "../constants/appLinks";
import { openContainingFolder, openFile } from "../utils/fileActions";
import { openExternalUrl } from "../utils/openUrl";
import { groupPathsByFolder, normalizePath } from "../utils/paths";

type SettingsPanel = "excluded" | "tags" | "duplicates";

export type SettingsViewHandle = {
  closeDetailPanel: () => boolean;
};

interface SettingsViewProps {
  settings: AppSettings;
  folders: WatchedFolder[];
  excludedPaths: string[];
  excludedPathSet: Set<string>;
  tagOrder: string[];
  libraryPathsByFolder: Map<string, string[]>;
  onChange: (patch: Partial<AppSettings>) => void;
  onRestoreExcluded: (path: string) => void;
  onRestoreExcludedPaths: (paths: string[]) => void;
  onExcludePath: (path: string) => void;
  onExcludePaths: (paths: string[]) => void;
  onOpenDiscordImport: () => void;
}

function menuIcon(icon: ReactNode): ReactNode {
  return <span className="menu-icon">{icon}</span>;
}

function buildDuplicateFileMenuItems(path: string): ContextMenuItem[] {
  return [
    {
      id: "open-file",
      label: "Open file",
      icon: menuIcon(<File size={15} strokeWidth={1.5} />),
      onClick: () => {
        void openFile(path);
      },
    },
    {
      id: "open-path",
      label: "Open path",
      icon: menuIcon(<FolderOpen size={15} strokeWidth={1.5} />),
      onClick: () => {
        void openContainingFolder(path);
      },
    },
    {
      id: "copy-path",
      label: "Copy path",
      icon: menuIcon(<Copy size={15} strokeWidth={1.5} />),
      onClick: () => {
        void copyPathToClipboard(path);
      },
    },
    {
      id: "copy-name",
      label: "Copy name",
      icon: menuIcon(<Copy size={15} strokeWidth={1.5} />),
      onClick: () => {
        void copyNameToClipboard(path);
      },
    },
  ];
}

function pruneDuplicateGroups(
  groups: DuplicateFileGroup[],
  excluded: Set<string>,
): DuplicateFileGroup[] {
  return groups
    .map((group) => ({
      ...group,
      files: group.files.filter((file) => !excluded.has(file.path)),
    }))
    .filter((group) => group.files.length >= 2);
}

interface SettingsNavRowProps {
  title: string;
  hint: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function SettingsNavRow({
  title,
  hint,
  count,
  active,
  onClick,
}: SettingsNavRowProps) {
  return (
    <button
      type="button"
      className={`settings-nav-row${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      <div className="settings-nav-row__body">
        <span className="settings-nav-row__title">{title}</span>
        <span className="settings-nav-row__hint">{hint}</span>
      </div>
      {count !== undefined && count > 0 && (
        <span className="settings-nav-row__count">{count}</span>
      )}
      <ChevronRight size={16} strokeWidth={1.5} className="settings-nav-row__chevron" />
    </button>
  );
}

function DetailPanel({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="settings-detail">
      <div className="settings-detail__header">
        <div>
          <h3 className="settings-detail__title">{title}</h3>
          {description && <p className="settings-detail__desc">{description}</p>}
        </div>
        <IconButton size="sm" label="Close panel" onClick={onClose}>
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      </div>
      <div className="settings-detail__body">{children}</div>
    </div>
  );
}

export const SettingsView = forwardRef<SettingsViewHandle, SettingsViewProps>(
  function SettingsView(
    {
      settings,
      folders,
      excludedPaths,
      excludedPathSet,
      tagOrder,
      libraryPathsByFolder,
      onChange,
      onRestoreExcluded,
      onRestoreExcludedPaths,
      onExcludePath,
      onExcludePaths,
      onOpenDiscordImport,
    },
    ref,
  ) {
    const [activePanel, setActivePanel] = useState<SettingsPanel | null>(null);
    const [hoveredPreviewPath, setHoveredPreviewPath] = useState<string | null>(
      null,
    );
    const [duplicateGroups, setDuplicateGroups] = useState<DuplicateFileGroup[]>(
      [],
    );
    const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
    const [duplicateScanError, setDuplicateScanError] = useState<string | null>(
      null,
    );
    const [duplicateScanProgress, setDuplicateScanProgress] =
      useState<DuplicateScanProgress | null>(null);
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      items: ContextMenuItem[];
    } | null>(null);
    const [excludedFolderFilter, setExcludedFolderFilter] = useState("all");
    const [restoreFolderSelection, setRestoreFolderSelection] = useState("");
    const [duplicateScanFolders, setDuplicateScanFolders] = useState<
      Set<string>
    >(() => new Set(folders.map((folder) => normalizePath(folder.path))));

    const showPreviewColumn =
      activePanel === "excluded" || activePanel === "duplicates";

    const visibleDuplicateGroups = useMemo(
      () => pruneDuplicateGroups(duplicateGroups, excludedPathSet),
      [duplicateGroups, excludedPathSet],
    );

    const duplicateFileCount = useMemo(
      () =>
        visibleDuplicateGroups.reduce(
          (total, group) => total + group.files.length,
          0,
        ),
      [visibleDuplicateGroups],
    );

    const excludedByFolder = useMemo(
      () => groupPathsByFolder(excludedPaths, folders),
      [excludedPaths, folders],
    );

    const excludedFolderOptions = useMemo(
      () =>
        folders
          .map((folder) => {
            const folderPath = normalizePath(folder.path);
            return {
              folderPath,
              name: folder.name,
              count: excludedByFolder.get(folderPath)?.length ?? 0,
            };
          })
          .filter((option) => option.count > 0),
      [excludedByFolder, folders],
    );

    const visibleExcludedPaths = useMemo(() => {
      if (excludedFolderFilter === "all") {
        return excludedPaths;
      }
      return (
        excludedByFolder.get(excludedFolderFilter) ?? []
      );
    }, [excludedByFolder, excludedFolderFilter, excludedPaths]);

    const duplicateScanPaths = useMemo(() => {
      const paths: string[] = [];
      for (const folderPath of duplicateScanFolders) {
        const folderPaths = libraryPathsByFolder.get(folderPath);
        if (folderPaths) {
          paths.push(...folderPaths);
        }
      }
      return paths;
    }, [duplicateScanFolders, libraryPathsByFolder]);

    const duplicateFolderOptions = useMemo(
      () =>
        folders.map((folder) => {
          const folderPath = normalizePath(folder.path);
          return {
            folderPath,
            name: folder.name,
            count: libraryPathsByFolder.get(folderPath)?.length ?? 0,
          };
        }),
      [folders, libraryPathsByFolder],
    );

    const duplicateScanListItems = useMemo(
      () =>
        duplicateFolderOptions.map((option) => ({
          id: option.folderPath,
          label: option.name,
          count: option.count,
          checked: duplicateScanFolders.has(option.folderPath),
        })),
      [duplicateFolderOptions, duplicateScanFolders],
    );

    const restoreFolderSelectOptions = useMemo<SelectOption[]>(
      () =>
        excludedFolderOptions.map((option) => ({
          value: option.folderPath,
          label: option.name,
          count: option.count,
        })),
      [excludedFolderOptions],
    );

    const excludedFilterOptions = useMemo<SelectOption[]>(
      () => [
        {
          value: "all",
          label: "All folders",
          count: excludedPaths.length,
        },
        ...excludedFolderOptions.map((option) => ({
          value: option.folderPath,
          label: option.name,
          count: option.count,
        })),
      ],
      [excludedFolderOptions, excludedPaths.length],
    );

    const closePanel = useCallback(() => {
      setActivePanel(null);
      setHoveredPreviewPath(null);
      setContextMenu(null);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        closeDetailPanel: () => {
          if (!activePanel) return false;
          closePanel();
          return true;
        },
      }),
      [activePanel, closePanel],
    );

    useEffect(() => {
      if (!activePanel) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closePanel();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [activePanel, closePanel]);

    useEffect(() => {
      setHoveredPreviewPath(null);
    }, [activePanel]);

    useEffect(() => {
      setDuplicateScanFolders(
        new Set(folders.map((folder) => normalizePath(folder.path))),
      );
    }, [folders]);

    useEffect(() => {
      if (
        restoreFolderSelection &&
        !excludedFolderOptions.some(
          (option) => option.folderPath === restoreFolderSelection,
        )
      ) {
        setRestoreFolderSelection("");
      }
      if (
        excludedFolderFilter !== "all" &&
        !excludedFolderOptions.some(
          (option) => option.folderPath === excludedFolderFilter,
        )
      ) {
        setExcludedFolderFilter("all");
      }
    }, [excludedFolderFilter, excludedFolderOptions, restoreFolderSelection]);

    useEffect(() => {
      if (hoveredPreviewPath && excludedPathSet.has(hoveredPreviewPath)) {
        if (activePanel !== "excluded") {
          setHoveredPreviewPath(null);
        }
      }
    }, [activePanel, excludedPathSet, hoveredPreviewPath]);

    const scanDuplicates = useCallback(async () => {
      if (duplicateScanFolders.size === 0) {
        setDuplicateGroups([]);
        setDuplicateScanError("Select at least one folder to scan.");
        return;
      }

      if (duplicateScanPaths.length === 0) {
        setDuplicateGroups([]);
        setDuplicateScanError("No media files in the selected folders to scan.");
        return;
      }

      setIsScanningDuplicates(true);
      setDuplicateScanError(null);
      setDuplicateScanProgress({
        phase: "metadata",
        scanned: 0,
        total: duplicateScanPaths.length,
      });

      try {
        const groups = await findDuplicateFiles(duplicateScanPaths, (progress) => {
          setDuplicateScanProgress(progress);
        });
        setDuplicateGroups(groups);
        if (groups.length === 0) {
          setDuplicateScanError("No duplicate files found.");
        }
      } catch (error) {
        console.error("[gif-picker] duplicate scan failed", error);
        setDuplicateScanError("Duplicate scan failed. Try again.");
        setDuplicateGroups([]);
      } finally {
        setIsScanningDuplicates(false);
        setDuplicateScanProgress(null);
      }
    }, [duplicateScanFolders.size, duplicateScanPaths]);

    const toggleDuplicateScanFolder = useCallback(
      (folderPath: string, checked: boolean) => {
        setDuplicateScanFolders((current) => {
          const next = new Set(current);
          if (checked) {
            next.add(folderPath);
          } else {
            next.delete(folderPath);
          }
          return next;
        });
      },
      [],
    );

    const restoreAllExcluded = useCallback(() => {
      if (excludedPaths.length === 0) return;
      onRestoreExcludedPaths(excludedPaths);
      setHoveredPreviewPath(null);
    }, [excludedPaths, onRestoreExcludedPaths]);

    const restoreExcludedFromFolder = useCallback(() => {
      if (!restoreFolderSelection) return;
      const paths = excludedByFolder.get(restoreFolderSelection) ?? [];
      if (paths.length === 0) return;
      onRestoreExcludedPaths(paths);
      setHoveredPreviewPath(null);
    }, [excludedByFolder, onRestoreExcludedPaths, restoreFolderSelection]);

    const excludeAllDuplicates = useCallback(() => {
      const paths = pathsToExcludeFromDuplicateGroups(visibleDuplicateGroups);
      if (paths.length === 0) return;
      onExcludePaths(paths);
      setHoveredPreviewPath(null);
    }, [onExcludePaths, visibleDuplicateGroups]);

    const previewFileName = hoveredPreviewPath
      ? fileNameFromPath(hoveredPreviewPath)
      : undefined;

    const openLink = useCallback((url: string) => {
      void openExternalUrl(url).catch((error) => {
        console.error("[gif-picker] failed to open link", error);
      });
    }, []);

    return (
      <div className="settings-shell">
        <div
          className={`settings-layout${
            showPreviewColumn ? " settings-layout--with-preview" : ""
          }`}
        >
          <div className="settings-layout__col settings-layout__col--main">
            <div className="settings-view__intro">
              <h2>Settings</h2>
              <p>Customize how your library is scanned, displayed, and previewed.</p>
            </div>

            <section className="settings-section">
              <h3 className="settings-section__title">Appearance</h3>
              <Toggle
                label="Dark mode"
                hint="Switch between light and dark color schemes"
                checked={settings.colorScheme === "dark"}
                onChange={(dark) =>
                  onChange({ colorScheme: dark ? "dark" : "light" })
                }
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Discord</h3>
              <p className="settings-section__note">
                Export your Discord favorite GIFs from the browser, then download them
                into a local folder and add it to your library.
              </p>
              <Button
                variant="secondary"
                size="md"
                icon={<Download size={14} strokeWidth={1.5} />}
                onClick={onOpenDiscordImport}
              >
                Import from Discord
              </Button>
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Library</h3>
              <Toggle
                label="Include video files"
                hint="Scan .mp4, .webm, .mov and other looped videos"
                checked={settings.includeVideos}
                onChange={(includeVideos) => onChange({ includeVideos })}
              />
              <Toggle
                label="Show folder paths"
                hint="Display the full path under each folder name in the sidebar"
                checked={settings.showFolderPaths}
                onChange={(showFolderPaths) => onChange({ showFolderPaths })}
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Clipboard</h3>
              <Toggle
                label="Always copy as .gif"
                hint="Non-GIF files paste with a .gif extension (.mp4, .webp, etc.). Original .gif files copy normally."
                checked={settings.copyAsGif}
                onChange={(copyAsGif) => onChange({ copyAsGif })}
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Grid display</h3>
              <Toggle
                label="Static thumbnails"
                hint="Show first frame in the grid to keep scrolling smooth"
                checked={settings.staticThumbnails}
                onChange={(staticThumbnails) => onChange({ staticThumbnails })}
              />
              <Toggle
                label="Preview on hover"
                hint="Play animation while hovering a grid item (uses static frame otherwise)"
                checked={settings.previewOnHover}
                onChange={(previewOnHover) => onChange({ previewOnHover })}
              />
              <Toggle
                label="Keep loaded thumbnails"
                hint="Retain mounted grid rows when scrolling back up"
                checked={settings.retainLoadedThumbnails}
                onChange={(retainLoadedThumbnails) =>
                  onChange({ retainLoadedThumbnails })
                }
              />
              <Slider
                label="Grid tile size"
                hint="Minimum width per tile"
                min={100}
                max={220}
                step={10}
                value={settings.gridCellMinWidth}
                formatValue={(v) => `${v}px`}
                onChange={(gridCellMinWidth) => onChange({ gridCellMinWidth })}
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Memory</h3>
              <p className="settings-section__note">
                Thumbnails are stored as in-memory images (the main RAM cost). When
                the budget is reached, oldest thumbnails unload first. Full GIFs load
                only in preview or on hover.
              </p>
              <Slider
                label="Thumbnail memory budget"
                hint="Oldest thumbnails unload when this limit is reached"
                min={32}
                max={512}
                step={32}
                value={settings.thumbnailCacheLimitMb || 128}
                formatValue={(v) => `${v} MB`}
                onChange={(thumbnailCacheLimitMb) =>
                  onChange({
                    thumbnailCacheLimitMb: Math.max(32, thumbnailCacheLimitMb),
                  })
                }
              />
              <Toggle
                label="Unlimited thumbnail memory"
                hint="Disable automatic unloading (not recommended for large libraries)"
                checked={settings.thumbnailCacheLimitMb === 0}
                onChange={(unlimited) =>
                  onChange({ thumbnailCacheLimitMb: unlimited ? 0 : 128 })
                }
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Manage</h3>
              <SettingsNavRow
                title="Tags"
                hint="Blur items by tag and manage tag behavior"
                count={tagOrder.length}
                active={activePanel === "tags"}
                onClick={() =>
                  setActivePanel((current) =>
                    current === "tags" ? null : "tags",
                  )
                }
              />
              <SettingsNavRow
                title="Excluded files"
                hint="Hidden from the grid but still on disk"
                count={excludedPaths.length}
                active={activePanel === "excluded"}
                onClick={() =>
                  setActivePanel((current) =>
                    current === "excluded" ? null : "excluded",
                  )
                }
              />
              <SettingsNavRow
                title="Duplicates"
                hint="Find identical files and hide extra copies"
                count={visibleDuplicateGroups.length}
                active={activePanel === "duplicates"}
                onClick={() =>
                  setActivePanel((current) =>
                    current === "duplicates" ? null : "duplicates",
                  )
                }
              />
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">About</h3>
              <div className="settings-about">
                <button
                  type="button"
                  className="settings-about__row"
                  onClick={() => openLink(GITHUB_REPO_URL)}
                >
                  <span className="settings-about__icon" aria-hidden>
                    <Github size={16} strokeWidth={1.5} />
                  </span>
                  <span className="settings-about__body">
                    <span className="settings-about__title">View on GitHub</span>
                    <span className="settings-about__hint">
                      Source code, issues, and releases
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.5}
                    className="settings-about__chevron"
                  />
                </button>
                <button
                  type="button"
                  className="settings-about__row"
                  onClick={() => openLink(GITHUB_PROFILE_URL)}
                >
                  <img
                    className="settings-about__avatar"
                    src={GITHUB_AVATAR_URL}
                    alt=""
                    aria-hidden
                    draggable={false}
                    width={28}
                    height={28}
                  />
                  <span className="settings-about__body">
                    <span className="settings-about__title">
                      Made by {GITHUB_AUTHOR}
                    </span>
                    <span className="settings-about__hint">GitHub profile</span>
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.5}
                    className="settings-about__chevron"
                  />
                </button>
              </div>
            </section>
          </div>

          <div
            className={`settings-layout__col settings-layout__col--detail${
              activePanel ? " has-panel" : ""
            }`}
          >
            {activePanel === "tags" && (
              <DetailPanel
                title="Tag settings"
                description="Choose which tags blur items in the grid. Blurred items stay in your library and can still be previewed or copied."
                onClose={closePanel}
              >
                {tagOrder.length === 0 ? (
                  <p className="settings-empty-note">
                    No tags yet. Create one from the sidebar or when assigning tags to an item.
                  </p>
                ) : (
                  <div className="tag-settings-grid">
                    {tagOrder.map((tag) => {
                      const blurEnabled = settings.blurTags.includes(tag);
                      return (
                        <div
                          key={tag}
                          className={`tag-settings-card${
                            blurEnabled ? " is-blur-enabled" : ""
                          }`}
                        >
                          <span className="tag-settings-card__name">#{tag}</span>
                          <IconButton
                            size="sm"
                            className={`tag-settings-card__eye${
                              blurEnabled ? " is-active" : ""
                            }`}
                            label={
                              blurEnabled
                                ? `Show items tagged “${tag}” in grid`
                                : `Blur items tagged “${tag}” in grid`
                            }
                            onClick={() => {
                              const blurTags = blurEnabled
                                ? settings.blurTags.filter((value) => value !== tag)
                                : [...settings.blurTags, tag];
                              onChange({ blurTags });
                            }}
                          >
                            {blurEnabled ? (
                              <EyeOff size={16} strokeWidth={1.5} />
                            ) : (
                              <Eye size={16} strokeWidth={1.5} />
                            )}
                          </IconButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DetailPanel>
            )}

            {activePanel === "excluded" && (
              <DetailPanel
                title="Excluded files"
                description="Hover a file to preview it. Restore items individually, by folder, or all at once."
                onClose={closePanel}
              >
                {excludedPaths.length === 0 ? (
                  <p className="settings-empty-note">No excluded files.</p>
                ) : (
                  <>
                    <div className="settings-action-bar">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={restoreAllExcluded}
                      >
                        Restore all
                      </Button>
                      {excludedFolderOptions.length > 0 && (
                        <div className="settings-action-bar__group">
                          <Select
                            value={restoreFolderSelection}
                            options={restoreFolderSelectOptions}
                            placeholder="Restore from folder…"
                            onChange={setRestoreFolderSelection}
                            fullWidth
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={restoreExcludedFromFolder}
                            disabled={!restoreFolderSelection}
                          >
                            Restore folder
                          </Button>
                        </div>
                      )}
                    </div>

                    {excludedFolderOptions.length > 1 && (
                      <div className="settings-action-bar__filter">
                        <Select
                          id="excluded-folder-filter"
                          label="Show"
                          value={excludedFolderFilter}
                          options={excludedFilterOptions}
                          onChange={setExcludedFolderFilter}
                          fullWidth
                        />
                      </div>
                    )}

                    <ul className="excluded-list">
                    {visibleExcludedPaths.map((path) => (
                      <li
                        key={path}
                        className={`excluded-list__item${
                          hoveredPreviewPath === path ? " is-hovered" : ""
                        }`}
                        onMouseEnter={() => setHoveredPreviewPath(path)}
                        onMouseLeave={() =>
                          setHoveredPreviewPath((current) =>
                            current === path ? null : current,
                          )
                        }
                      >
                        <div className="excluded-list__info">
                          <span className="excluded-list__name">
                            {fileNameFromPath(path)}
                          </span>
                          <span className="excluded-list__path">{path}</span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onRestoreExcluded(path)}
                        >
                          Restore
                        </Button>
                      </li>
                    ))}
                    </ul>
                  </>
                )}
              </DetailPanel>
            )}

            {activePanel === "duplicates" && (
              <DetailPanel
                title="Duplicate files"
                description="Scans file contents (not names). Choose folders, then compare copies and exclude any you do not need."
                onClose={closePanel}
              >
                {duplicateFolderOptions.length > 0 && (
                  <OptionList
                    title="Folders to scan"
                    items={duplicateScanListItems}
                    onToggle={toggleDuplicateScanFolder}
                    onSelectAll={() =>
                      setDuplicateScanFolders(
                        new Set(
                          duplicateFolderOptions.map(
                            (option) => option.folderPath,
                          ),
                        ),
                      )
                    }
                    onSelectNone={() => setDuplicateScanFolders(new Set())}
                  />
                )}

                <div className="duplicates-toolbar">
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<RefreshCw size={14} strokeWidth={1.5} />}
                    onClick={() => void scanDuplicates()}
                    disabled={
                      isScanningDuplicates || duplicateScanFolders.size === 0
                    }
                  >
                    {isScanningDuplicates
                      ? "Scanning…"
                      : duplicateScanFolders.size === folders.length
                        ? "Scan library"
                        : "Scan selected"}
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={excludeAllDuplicates}
                    disabled={
                      isScanningDuplicates ||
                      pathsToExcludeFromDuplicateGroups(visibleDuplicateGroups)
                        .length === 0
                    }
                  >
                    Exclude all duplicates
                  </Button>
                </div>

                {isScanningDuplicates && duplicateScanProgress && (
                  <div className="duplicate-scan-progress">
                    <div className="duplicate-scan-progress__label">
                      {duplicateScanProgressLabel(duplicateScanProgress)}
                    </div>
                    <div className="duplicate-scan-progress__track">
                      <div
                        className="duplicate-scan-progress__fill"
                        style={{
                          width: `${duplicateScanProgressPercent(duplicateScanProgress)}%`,
                        }}
                      />
                    </div>
                    {duplicateScanProgress.currentPath && (
                      <div className="duplicate-scan-progress__file">
                        {fileNameFromPath(duplicateScanProgress.currentPath)}
                      </div>
                    )}
                  </div>
                )}

                {duplicateScanError && (
                  <p className="settings-empty-note">{duplicateScanError}</p>
                )}

                {!duplicateScanError &&
                  visibleDuplicateGroups.length > 0 && (
                    <p className="duplicates-summary">
                      {visibleDuplicateGroups.length} duplicate group
                      {visibleDuplicateGroups.length === 1 ? "" : "s"} ·{" "}
                      {duplicateFileCount} files
                    </p>
                  )}

                {visibleDuplicateGroups.length > 0 && (
                  <div className="duplicate-groups">
                    {visibleDuplicateGroups.map((group) => (
                      <section key={group.hash} className="duplicate-group">
                        <div className="duplicate-group__header">
                          <Copy size={14} strokeWidth={1.5} />
                          <span>
                            {group.files.length} identical files ·{" "}
                            {formatFileSize(group.files[0]?.size ?? 0)}
                          </span>
                        </div>
                        <ul className="duplicate-group__list">
                          {group.files.map((file) => (
                            <li
                              key={file.path}
                              className={`duplicate-file-row${
                                hoveredPreviewPath === file.path
                                  ? " is-hovered"
                                  : ""
                              }`}
                              onMouseEnter={() =>
                                setHoveredPreviewPath(file.path)
                              }
                              onMouseLeave={() =>
                                setHoveredPreviewPath((current) =>
                                  current === file.path ? null : current,
                                )
                              }
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setContextMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  items: buildDuplicateFileMenuItems(file.path),
                                });
                              }}
                            >
                              <div className="duplicate-file-row__info">
                                <span className="duplicate-file-row__name">
                                  {fileNameFromPath(file.path)}
                                </span>
                                <span className="duplicate-file-row__path">
                                  {file.path}
                                </span>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onExcludePath(file.path)}
                              >
                                Exclude
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </DetailPanel>
            )}
          </div>

          {showPreviewColumn && (
            <div className="settings-layout__col settings-layout__col--preview">
              <SettingsPreviewPane
                path={hoveredPreviewPath}
                fileName={previewFileName}
                filePath={hoveredPreviewPath ?? undefined}
              />
            </div>
          )}
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  },
);