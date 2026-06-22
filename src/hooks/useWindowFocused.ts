import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      const sync = () => {
        setFocused(
          document.visibilityState === "visible" && document.hasFocus(),
        );
      };
      document.addEventListener("visibilitychange", sync);
      window.addEventListener("focus", sync);
      window.addEventListener("blur", sync);
      sync();
      return () => {
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("focus", sync);
        window.removeEventListener("blur", sync);
      };
    }

    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void appWindow.isFocused().then(setFocused);
    void appWindow
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      void unlisten?.();
    };
  }, []);

  return focused;
}