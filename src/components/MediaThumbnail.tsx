import { memo, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Film, ImageIcon } from "lucide-react";

import {
  getCachedThumbnail,
  requestThumbnail,
} from "../utils/extractFirstFrame";
import { isVideoPath, type MediaKind } from "../utils/mediaTypes";

interface MediaThumbnailProps {
  path: string;
  alt: string;
  staticOnly: boolean;
  kind?: MediaKind;
}

export const MediaThumbnail = memo(function MediaThumbnail({
  path,
  alt,
  staticOnly,
  kind,
}: MediaThumbnailProps) {
  const assetUrl = convertFileSrc(path);
  const isVideo = kind === "video" || isVideoPath(path);
  const [src, setSrc] = useState(() => getCachedThumbnail(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!staticOnly) {
      setSrc(assetUrl);
      setFailed(false);
      return;
    }

    const cached = getCachedThumbnail(path);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setSrc(null);
    setFailed(false);

    void requestThumbnail(path, assetUrl)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [path, assetUrl, staticOnly]);

  if (!staticOnly && src) {
    if (isVideo) {
      return (
        <video
          src={src}
          className="gif-thumbnail-img"
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
        />
      );
    }
    return (
      <img
        src={src}
        alt={alt}
        decoding="async"
        draggable={false}
        className="gif-thumbnail-img"
      />
    );
  }

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        decoding="async"
        draggable={false}
        className="gif-thumbnail-img"
      />
    );
  }

  if (failed) {
    return (
      <div className="gif-thumbnail-fallback" aria-hidden>
        {isVideo ? (
          <Film size={22} strokeWidth={1.5} />
        ) : (
          <ImageIcon size={22} strokeWidth={1.5} />
        )}
      </div>
    );
  }

  return <div className="gif-thumbnail-skeleton" aria-hidden />;
});