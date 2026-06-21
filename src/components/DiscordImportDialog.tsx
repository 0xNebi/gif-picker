import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileJson,
  FolderDown,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Select, type SelectOption } from "./ui/Select";
import {
  DISCORD_APP_URL,
  DISCORD_EXTRACT_SCRIPT,
  filterNewDiscordUrls,
  parseDiscordExportJson,
  type DiscordImportMode,
} from "../utils/discordGifs";
import {
  loadDiscordImportRecord,
  saveDiscordImportRecord,
} from "../utils/discordImportState";

interface DiscordDownloadProgress {
  downloaded: number;
  skipped: number;
  failed: number;
  total: number;
  current_url?: string | null;
  current_file?: string | null;
}

interface DiscordDownloadResult {
  downloaded: number;
  skipped: number;
  failed: number;
  dest_dir: string;
  paths: string[];
}

interface DiscordImportDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete: (destDir: string) => void;
  showToast: (message: string) => void;
}

const IMPORT_MODE_OPTIONS: SelectOption[] = [
  {
    value: "all",
    label: "All GIFs",
    hint: "Download every URL from the export (skip files already on disk)",
  },
  {
    value: "new-only",
    label: "New only",
    hint: "Compare with your last import and download only new URLs",
  },
];

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function DiscordImportDialog({
  open: isOpen,
  onClose,
  onComplete,
  showToast,
}: DiscordImportDialogProps) {
  const titleId = useId();
  const [scriptCopied, setScriptCopied] = useState(false);
  const [gifUrls, setGifUrls] = useState<string[]>([]);
  const [importLabel, setImportLabel] = useState<string | null>(null);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DiscordDownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<DiscordImportMode>("all");
  const [previousUrls, setPreviousUrls] = useState<string[]>([]);
  const [previousImportLoaded, setPreviousImportLoaded] = useState(false);
  const [hasPersistedHistory, setHasPersistedHistory] = useState(false);
  const [previousBaselineLabel, setPreviousBaselineLabel] = useState<string | null>(
    null,
  );

  const resetState = useCallback(() => {
    setScriptCopied(false);
    setGifUrls([]);
    setImportLabel(null);
    setDestDir(null);
    setIsDownloading(false);
    setDownloadProgress(null);
    setDownloadError(null);
    setImportMode("all");
    setPreviousUrls([]);
    setPreviousImportLoaded(false);
    setHasPersistedHistory(false);
    setPreviousBaselineLabel(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDownloading) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDownloading, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !isDownloading) return;

    let unlisten: (() => void) | undefined;

    void listen<DiscordDownloadProgress>("discord-download-progress", (event) => {
      setDownloadProgress(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [isDownloading, isOpen]);

  const openDiscord = useCallback(async () => {
    try {
      await invoke("open_url", { url: DISCORD_APP_URL });
    } catch (error) {
      console.error("[gif-picker] failed to open Discord", error);
      showToast("Could not open Discord in your browser");
    }
  }, [showToast]);

  const copyScript = useCallback(async () => {
    try {
      await invoke("copy_text_to_clipboard", { text: DISCORD_EXTRACT_SCRIPT });
      setScriptCopied(true);
      showToast("Extraction script copied — paste it in Discord DevTools");
      window.setTimeout(() => setScriptCopied(false), 2400);
    } catch (error) {
      console.error("[gif-picker] failed to copy Discord script", error);
      showToast("Could not copy script to clipboard");
    }
  }, [showToast]);

  const openDiscordAndCopyScript = useCallback(async () => {
    await openDiscord();
    await copyScript();
  }, [copyScript, openDiscord]);

  const importJsonFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      title: "Select discord-favorite-gifs.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!selected || typeof selected !== "string") return;

    try {
      const raw = await readTextFile(selected);
      const urls = parseDiscordExportJson(raw);
      if (urls.length === 0) {
        setDownloadError("No GIF URLs found in that JSON file.");
        setGifUrls([]);
        setImportLabel(null);
        return;
      }

      setGifUrls(urls);
      setImportLabel(fileNameFromPath(selected));
      setDownloadError(null);
      showToast(`Found ${urls.length} GIF URLs`);
    } catch (error) {
      console.error("[gif-picker] failed to parse Discord JSON", error);
      setDownloadError("Could not read that JSON file. Export again from Discord.");
      setGifUrls([]);
      setImportLabel(null);
    }
  }, [showToast]);

  const chooseDestination = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose folder for downloaded GIFs",
    });

    if (!selected || typeof selected !== "string") return;

    const normalized = selected.replace(/\\/g, "/");
    setDestDir(normalized);
    setDownloadError(null);
    setPreviousImportLoaded(false);
    setPreviousBaselineLabel(null);

    try {
      const record = await loadDiscordImportRecord(normalized);
      const savedUrls = record?.urls ?? [];
      setPreviousUrls(savedUrls);
      setHasPersistedHistory(savedUrls.length > 0);
      setPreviousImportLoaded(true);
      if (savedUrls.length > 0) {
        setImportMode("new-only");
      }
    } catch (error) {
      console.error("[gif-picker] failed to load Discord import history", error);
      setPreviousUrls([]);
      setHasPersistedHistory(false);
      setPreviousImportLoaded(true);
    }
  }, []);

  const loadPreviousBaseline = useCallback(async () => {
    const selected = await open({
      multiple: false,
      title: "Select your previous discord-favorite-gifs.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!selected || typeof selected !== "string") return;

    try {
      const raw = await readTextFile(selected);
      const urls = parseDiscordExportJson(raw);
      if (urls.length === 0) {
        setDownloadError("No GIF URLs found in that previous export.");
        return;
      }

      setPreviousUrls(urls);
      setPreviousBaselineLabel(fileNameFromPath(selected));
      setImportMode("new-only");
      setDownloadError(null);
      showToast(`Loaded ${urls.length} URLs from previous export`);
    } catch (error) {
      console.error("[gif-picker] failed to parse previous Discord JSON", error);
      setDownloadError("Could not read that JSON file.");
    }
  }, [showToast]);

  const urlsToDownload = useMemo(() => {
    if (importMode === "all") return gifUrls;
    return filterNewDiscordUrls(gifUrls, previousUrls);
  }, [gifUrls, importMode, previousUrls]);

  const newUrlCount = useMemo(
    () => filterNewDiscordUrls(gifUrls, previousUrls).length,
    [gifUrls, previousUrls],
  );

  const downloadGifs = useCallback(async () => {
    if (gifUrls.length === 0 || !destDir) return;

    if (importMode === "new-only" && urlsToDownload.length === 0) {
      try {
        await saveDiscordImportRecord(destDir, gifUrls);
      } catch (error) {
        console.error("[gif-picker] failed to save Discord import history", error);
      }
      showToast("No new GIFs — your library is up to date");
      onComplete(destDir);
      onClose();
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress({
      downloaded: 0,
      skipped: 0,
      failed: 0,
      total: urlsToDownload.length,
    });

    try {
      const result = await invoke<DiscordDownloadResult>("download_discord_gifs", {
        urls: urlsToDownload,
        destDir,
      });

      try {
        await saveDiscordImportRecord(destDir, gifUrls);
      } catch (error) {
        console.error("[gif-picker] failed to save Discord import history", error);
      }

      if (result.downloaded === 0) {
        if (result.failed === 0 && result.skipped > 0) {
          showToast("No new GIFs — existing files kept, import history saved");
          onComplete(destDir);
          onClose();
          return;
        }

        setDownloadError(
          result.failed > 0
            ? "Download failed for every GIF. Check your connection and try again."
            : importMode === "new-only"
              ? "No new GIFs were downloaded."
              : "No GIFs were downloaded.",
        );
        return;
      }

      const summary =
        result.failed > 0
          ? `Downloaded ${result.downloaded} GIFs (${result.failed} failed)`
          : importMode === "new-only"
            ? `Downloaded ${result.downloaded} new GIFs`
            : `Downloaded ${result.downloaded} GIFs`;
      showToast(summary);
      onComplete(destDir);
      onClose();
    } catch (error) {
      console.error("[gif-picker] Discord GIF download failed", error);
      setDownloadError("Download failed. Try again.");
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  }, [
    destDir,
    gifUrls,
    importMode,
    onClose,
    onComplete,
    showToast,
    urlsToDownload,
  ]);

  if (!isOpen) return null;

  const progressPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round(
          ((downloadProgress.downloaded +
            downloadProgress.skipped +
            downloadProgress.failed) /
            downloadProgress.total) *
            100,
        )
      : 0;

  return (
    <div className="dialog-backdrop" onClick={isDownloading ? undefined : onClose}>
      <div
        className="discord-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="discord-import-dialog__header">
          <div>
            <h3 id={titleId}>Import from Discord</h3>
            <p className="discord-import-dialog__subtitle">
              Export your Discord favorite GIFs, then download them into your library.
            </p>
          </div>
          <IconButton
            size="sm"
            label="Close dialog"
            onClick={onClose}
            disabled={isDownloading}
          >
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </div>

        <ol className="discord-import-steps">
          <li className="discord-import-step">
            <div className="discord-import-step__head">
              <span className="discord-import-step__number">1</span>
              <div>
                <h4>Open Discord and export favorites</h4>
                <p>
                  Open Discord in your browser, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
                  <kbd>I</kbd> to open DevTools, go to the <strong>Console</strong> tab,
                  paste the script, and press Enter. A{" "}
                  <code>discord-favorite-gifs.json</code> file will download.
                </p>
              </div>
            </div>
            <div className="discord-import-step__actions">
              <Button
                variant="primary"
                size="md"
                icon={<ExternalLink size={14} strokeWidth={1.5} />}
                onClick={() => void openDiscordAndCopyScript()}
              >
                Open Discord &amp; copy script
              </Button>
              <Button
                variant="secondary"
                size="md"
                icon={
                  scriptCopied ? (
                    <Check size={14} strokeWidth={1.5} />
                  ) : (
                    <ClipboardCopy size={14} strokeWidth={1.5} />
                  )
                }
                success={scriptCopied}
                onClick={() => void copyScript()}
              >
                {scriptCopied ? "Copied" : "Copy script"}
              </Button>
            </div>
            <pre className="discord-import-script" aria-label="Discord extraction script">
              {DISCORD_EXTRACT_SCRIPT}
            </pre>
          </li>

          <li className="discord-import-step">
            <div className="discord-import-step__head">
              <span className="discord-import-step__number">2</span>
              <div>
                <h4>Import the JSON export</h4>
                <p>Select the JSON file you exported from Discord.</p>
              </div>
            </div>
            <div className="discord-import-step__actions">
              <Button
                variant="secondary"
                size="md"
                icon={<FileJson size={14} strokeWidth={1.5} />}
                onClick={() => void importJsonFile()}
                disabled={isDownloading}
              >
                Choose JSON file
              </Button>
              {importLabel && (
                <span className="discord-import-status">
                  {importLabel} · {gifUrls.length} GIF
                  {gifUrls.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </li>

          <li className="discord-import-step">
            <div className="discord-import-step__head">
              <span className="discord-import-step__number">3</span>
              <div>
                <h4>Download GIFs to a folder</h4>
                <p>
                  Pick a destination folder and choose whether to import everything or
                  only GIFs that are new since your last import to that folder.
                </p>
              </div>
            </div>
            <div className="discord-import-step__actions">
              <Button
                variant="secondary"
                size="md"
                icon={<FolderDown size={14} strokeWidth={1.5} />}
                onClick={() => void chooseDestination()}
                disabled={isDownloading || gifUrls.length === 0}
              >
                Choose folder
              </Button>
              {destDir && (
                <span className="discord-import-status" title={destDir}>
                  {fileNameFromPath(destDir)}
                </span>
              )}
            </div>
            {gifUrls.length > 0 && destDir && previousImportLoaded && (
              <div className="discord-import-mode">
                <Select
                  label="Import mode"
                  value={importMode}
                  options={IMPORT_MODE_OPTIONS}
                  onChange={(value) => setImportMode(value as DiscordImportMode)}
                  disabled={isDownloading}
                  fullWidth
                />
                {importMode === "new-only" && previousUrls.length === 0 && (
                  <div className="discord-import-baseline">
                    <p className="discord-import-mode__note">
                      No saved import history for this folder. If you imported here before
                      this update, load an older <code>discord-favorite-gifs.json</code> to
                      compare — otherwise every URL is treated as new (files already on
                      disk are still skipped).
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<FileJson size={14} strokeWidth={1.5} />}
                      onClick={() => void loadPreviousBaseline()}
                      disabled={isDownloading}
                    >
                      Load previous export
                    </Button>
                  </div>
                )}
                {importMode === "new-only" && previousUrls.length > 0 && (
                  <p className="discord-import-mode__note">
                    <span className="discord-import-mode__count">{newUrlCount}</span> new
                    of {gifUrls.length} GIF
                    {gifUrls.length === 1 ? "" : "s"}
                    {hasPersistedHistory
                      ? " since your last import"
                      : previousBaselineLabel
                        ? ` compared to ${previousBaselineLabel}`
                        : " compared to previous export"}
                  </p>
                )}
              </div>
            )}
          </li>
        </ol>

        {isDownloading && downloadProgress && (
          <div className="discord-import-progress">
            <div className="discord-import-progress__label">
              Downloading {downloadProgress.downloaded + downloadProgress.skipped + downloadProgress.failed} of{" "}
              {downloadProgress.total}
              {downloadProgress.failed > 0 &&
                ` · ${downloadProgress.failed} failed`}
            </div>
            <div className="discord-import-progress__track">
              <div
                className="discord-import-progress__fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {downloadProgress.current_file && (
              <div className="discord-import-progress__file">
                {downloadProgress.current_file}
              </div>
            )}
          </div>
        )}

        {downloadError && (
          <p className="discord-import-error">{downloadError}</p>
        )}

        <div className="discord-import-dialog__footer">
          <Button variant="ghost" size="md" onClick={onClose} disabled={isDownloading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={<Download size={14} strokeWidth={1.5} />}
            onClick={() => void downloadGifs()}
            disabled={isDownloading || gifUrls.length === 0 || !destDir}
            loading={isDownloading}
          >
            {isDownloading
              ? "Downloading…"
              : importMode === "new-only" && urlsToDownload.length === 0
                ? "Up to date"
                : importMode === "new-only"
                  ? `Download ${urlsToDownload.length} new GIF${urlsToDownload.length === 1 ? "" : "s"}`
                  : "Download GIFs"}
          </Button>
        </div>
      </div>
    </div>
  );
}