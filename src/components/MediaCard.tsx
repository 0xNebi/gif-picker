import { memo, useState } from "react";
import { Star } from "lucide-react";

import { MediaThumbnail } from "./MediaThumbnail";
import type { MediaFile } from "../utils/mediaTypes";

interface MediaCardProps {
  media: MediaFile;
  width: number;
  height: number;
  x: number;
  y: number;
  staticThumbnails: boolean;
  previewOnHover: boolean;
  isFavorite: boolean;
  isBlurred: boolean;
  onSelect: (media: MediaFile) => void;
  onContextMenu: (media: MediaFile, x: number, y: number) => void;
  onHoverChange?: (media: MediaFile | null) => void;
}

export const MediaCard = memo(function MediaCard({
  media,
  width,
  height,
  x,
  y,
  staticThumbnails,
  previewOnHover,
  isFavorite,
  isBlurred,
  onSelect,
  onContextMenu,
  onHoverChange,
}: MediaCardProps) {
  const [hovered, setHovered] = useState(false);
  const staticOnly =
    staticThumbnails && !(previewOnHover && hovered);

  return (
    <div
      className={`gif-card gif-card-virtual${hovered ? " is-hovered" : ""}${isBlurred ? " is-blurred" : ""}`}
      style={{
        width,
        height,
        transform: `translate3d(${x}px, ${y}px, 0)`,
      }}
      onClick={() => onSelect(media)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(media, event.clientX, event.clientY);
      }}
      onMouseEnter={() => {
        setHovered(true);
        onHoverChange?.(media);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverChange?.(null);
      }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/media-path", media.path);
        event.dataTransfer.effectAllowed = "copyMove";
      }}
    >
      <MediaThumbnail
        path={media.path}
        alt={media.name}
        staticOnly={staticOnly}
      />
      {isFavorite && (
        <div className="gif-favorite-badge" aria-label="Favorite">
          <Star size={12} fill="currentColor" />
        </div>
      )}
      {media.kind === "video" && (
        <div className="gif-type-badge">VIDEO</div>
      )}
    </div>
  );
});