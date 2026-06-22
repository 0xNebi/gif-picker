import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "installing"
  | "ready"
  | "unavailable"
  | "error";

export interface AppUpdaterState {
  appVersion: string;
  phase: UpdatePhase;
  availableVersion: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  statusMessage: string;
  errorMessage: string | null;
  updatesSupported: boolean;
  checkForUpdates: (options?: { autoInstall?: boolean }) => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunchApp: () => Promise<void>;
}

function updatesSupportedInThisBuild(): boolean {
  return import.meta.env.PROD;
}

function statusForPhase(phase: UpdatePhase, availableVersion: string | null): string {
  switch (phase) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return availableVersion
        ? `Version ${availableVersion} is available`
        : "An update is available";
    case "up-to-date":
      return "You're on the latest version";
    case "downloading":
      return "Downloading update…";
    case "installing":
      return "Installing update…";
    case "ready":
      return "Update installed — restart to finish";
    case "unavailable":
      return "Updates are available in installed releases only";
    case "error":
      return "Could not check for updates";
    default:
      return "";
  }
}

export function useAppUpdater(): AppUpdaterState {
  const updatesSupported = updatesSupportedInThisBuild();
  const pendingUpdateRef = useRef<Update | null>(null);
  const downloadedBytesRef = useRef(0);
  const contentLengthRef = useRef<number | undefined>(undefined);

  const [appVersion, setAppVersion] = useState("…");
  const [phase, setPhase] = useState<UpdatePhase>(
    updatesSupported ? "idle" : "unavailable",
  );
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch((error) => {
        console.error("[gif-picker] failed to read app version", error);
        setAppVersion("unknown");
      });
  }, []);

  const clearPendingUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    if (pending) {
      try {
        await pending.close();
      } catch {
        // already closed
      }
    }
  }, []);

  const handleDownloadEvent = useCallback((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        downloadedBytesRef.current = 0;
        contentLengthRef.current = event.data.contentLength;
        setProgressPercent(
          event.data.contentLength ? 0 : null,
        );
        setPhase("downloading");
        break;
      case "Progress":
        downloadedBytesRef.current += event.data.chunkLength;
        if (contentLengthRef.current && contentLengthRef.current > 0) {
          setProgressPercent(
            Math.min(
              100,
              Math.round(
                (downloadedBytesRef.current / contentLengthRef.current) * 100,
              ),
            ),
          );
        }
        break;
      case "Finished":
        setProgressPercent(100);
        setPhase("installing");
        break;
    }
  }, []);

  const installPendingUpdate = useCallback(
    async (options?: { relaunchAfterInstall?: boolean }) => {
      const update = pendingUpdateRef.current;
      if (!update) {
        setPhase("error");
        setErrorMessage("No pending update to install.");
        return;
      }

      setErrorMessage(null);
      setProgressPercent(null);

      try {
        await update.downloadAndInstall(handleDownloadEvent);
        pendingUpdateRef.current = null;
        setAvailableVersion(null);
        setReleaseNotes(null);
        setProgressPercent(null);

        if (options?.relaunchAfterInstall ?? true) {
          await relaunch();
          return;
        }

        setPhase("ready");
      } catch (error) {
        console.error("[gif-picker] update install failed", error);
        setPhase("error");
        setErrorMessage("Update failed. Try again or download from GitHub.");
        setProgressPercent(null);
      }
    },
    [handleDownloadEvent],
  );

  const checkForUpdates = useCallback(
    async (options?: { autoInstall?: boolean }) => {
      if (!updatesSupported) {
        setPhase("unavailable");
        setErrorMessage(null);
        return;
      }

      await clearPendingUpdate();
      setPhase("checking");
      setErrorMessage(null);
      setProgressPercent(null);
      setAvailableVersion(null);
      setReleaseNotes(null);

      try {
        const update = await check();
        if (!update) {
          pendingUpdateRef.current = null;
          setPhase("up-to-date");
          return;
        }

        pendingUpdateRef.current = update;
        setAvailableVersion(update.version);
        setReleaseNotes(update.body ?? null);

        if (options?.autoInstall) {
          await installPendingUpdate({ relaunchAfterInstall: true });
          return;
        }

        setPhase("available");
      } catch (error) {
        console.error("[gif-picker] update check failed", error);
        pendingUpdateRef.current = null;
        setPhase("error");
        setErrorMessage(
          "Could not reach the update server. Check your connection or try again later.",
        );
      }
    },
    [clearPendingUpdate, installPendingUpdate, updatesSupported],
  );

  const installUpdate = useCallback(async () => {
    await installPendingUpdate({ relaunchAfterInstall: true });
  }, [installPendingUpdate]);

  const relaunchApp = useCallback(async () => {
    try {
      await relaunch();
    } catch (error) {
      console.error("[gif-picker] relaunch failed", error);
      setPhase("error");
      setErrorMessage("Could not restart the app. Close and reopen it manually.");
    }
  }, []);

  return {
    appVersion,
    phase,
    availableVersion,
    releaseNotes,
    progressPercent,
    statusMessage: statusForPhase(phase, availableVersion),
    errorMessage,
    updatesSupported,
    checkForUpdates,
    installUpdate,
    relaunchApp,
  };
}