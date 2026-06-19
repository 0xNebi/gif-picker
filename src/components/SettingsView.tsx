import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight, Eye, EyeOff, X } from "lucide-react";

import { Slider } from "./ui/Slider";
import { Toggle } from "./ui/Toggle";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import type { AppSettings } from "../store/useLibraryStore";

type SettingsPanel = "excluded" | "tags";

export type SettingsViewHandle = {
  closeDetailPanel: () => boolean;
};

interface SettingsViewProps {
  settings: AppSettings;
  excludedPaths: string[];
  tagOrder: string[];
  onChange: (patch: Partial<AppSettings>) => void;
  onRestoreExcluded: (path: string) => void;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
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
    { settings, excludedPaths, tagOrder, onChange, onRestoreExcluded },
    ref,
  ) {
    const [activePanel, setActivePanel] = useState<SettingsPanel | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        closeDetailPanel: () => {
          if (!activePanel) return false;
          setActivePanel(null);
          return true;
        },
      }),
      [activePanel],
    );

    useEffect(() => {
      if (!activePanel) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setActivePanel(null);
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [activePanel]);

    const closePanel = () => setActivePanel(null);

    return (
      <div className="settings-shell">
        <div className="settings-layout">
          <div className="settings-layout__col settings-layout__col--main">
          <div className="settings-view__intro">
            <h2>Settings</h2>
            <p>Customize how your library is scanned, displayed, and previewed.</p>
          </div>

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
              description="Restore any item you excluded by mistake. Files stay on disk until you delete them manually."
              onClose={closePanel}
            >
              {excludedPaths.length === 0 ? (
                <p className="settings-empty-note">No excluded files.</p>
              ) : (
                <ul className="excluded-list">
                  {excludedPaths.map((path) => (
                    <li key={path} className="excluded-list__item">
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
              )}
            </DetailPanel>
          )}
          </div>
        </div>
      </div>
    );
  },
);