import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";

import { usePrivacyMask } from "../contexts/PrivacyMaskContext";
import { isVideoPath, mimeForPath, resolveMediaKind } from "../utils/mediaTypes";

interface MediaPreviewProps {
  path: string;
  alt: string;
  className?: string;
}

export function MediaPreview({ path, alt, className }: MediaPreviewProps) {
  const privacyMasked = usePrivacyMask();
  const [src, setSrc] = useState(() => convertFileSrc(path));
  const [triedFallback, setTriedFallback] = useState(false);
  const [isVideo, setIsVideo] = useState(() => isVideoPath(path));

  useEffect(() => {
    setSrc(convertFileSrc(path));
    setTriedFallback(false);
    if (isVideoPath(path)) {
      setIsVideo(true);
      return;
    }

    let cancelled = false;
    void resolveMediaKind(path).then((kind) => {
      if (!cancelled) {
        setIsVideo(kind === "video");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    return () => {
      if (src.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
  }, [src]);

  const handleError = async () => {
    if (triedFallback) return;
    try {
      const bytes = await readFile(path);
      const blob = new Blob([bytes], { type: mimeForPath(path) });
      const blobUrl = URL.createObjectURL(blob);
      setSrc(blobUrl);
      setTriedFallback(true);
    } catch (err) {
      console.error("[gif-picker] Preview fallback failed for", path, err);
    }
  };

  if (privacyMasked) {
    return (
      <div
        className={[className, "gif-thumbnail-skeleton", "media-preview-privacy"]
          .filter(Boolean)
          .join(" ")}
        role="img"
        aria-label={`${alt} (hidden while app is in background)`}
      />
    );
  }

  if (isVideo) {
    return (
      <video
        src={src}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        controls
        onError={handleError}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      decoding="async"
      onError={handleError}
    />
  );
}