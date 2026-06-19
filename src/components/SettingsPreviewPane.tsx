import { MediaPreview } from "./MediaPreview";

interface SettingsPreviewPaneProps {
  path: string | null;
  fileName?: string;
  filePath?: string;
}

export function SettingsPreviewPane({
  path,
  fileName,
  filePath,
}: SettingsPreviewPaneProps) {
  if (!path) {
    return (
      <div className="settings-preview-pane is-empty">
        <p>Hover a file to preview</p>
      </div>
    );
  }

  return (
    <div className="settings-preview-pane">
      {fileName && (
        <div className="settings-preview-pane__name">{fileName}</div>
      )}
      <div className="settings-preview-pane__frame">
        <MediaPreview
          path={path}
          alt={fileName ?? "Preview"}
          className="settings-preview-pane__media"
        />
      </div>
      {filePath && (
        <div className="settings-preview-pane__path">{filePath}</div>
      )}
    </div>
  );
}