import { getCurrentWindow } from "@tauri-apps/api/window";

function stopDrag(event: React.MouseEvent | React.PointerEvent) {
  event.stopPropagation();
}

export function WindowControls() {
  return (
    <div className="titlebar-right" data-tauri-drag-region={false}>
      <button
        type="button"
        className="window-control-btn"
        data-tauri-drag-region={false}
        onMouseDown={stopDrag}
        onPointerDown={stopDrag}
        onClick={() => void getCurrentWindow().minimize()}
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden>
          <rect width="10" height="1" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn"
        data-tauri-drag-region={false}
        onMouseDown={stopDrag}
        onPointerDown={stopDrag}
        onClick={() => {
          void (async () => {
            const win = getCurrentWindow();
            if (await win.isMaximized()) {
              await win.unmaximize();
            } else {
              await win.maximize();
            }
          })();
        }}
        aria-label="Maximize or restore"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect
            x="0.75"
            y="0.75"
            width="8.5"
            height="8.5"
            rx="1.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn window-control-btn--close"
        data-tauri-drag-region={false}
        onMouseDown={stopDrag}
        onPointerDown={stopDrag}
        onClick={() => void getCurrentWindow().close()}
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}