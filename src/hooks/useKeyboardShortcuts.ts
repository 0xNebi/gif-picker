import { useEffect } from "react";

interface KeyboardShortcutHandlers {
  onFocusSearch?: () => void;
  /** Return true when the shortcut was handled (prevents default copy). */
  onCopy?: () => boolean;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const tag =
        target instanceof HTMLElement ? target.tagName.toLowerCase() : "";
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "k")) {
        event.preventDefault();
        handlers.onFocusSearch?.();
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        !isTyping &&
        handlers.onCopy?.()
      ) {
        event.preventDefault();
        return;
      }

      if (event.key === "Escape" && !isTyping) {
        handlers.onEscape?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}