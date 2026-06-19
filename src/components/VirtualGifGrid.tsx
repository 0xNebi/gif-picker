import { memo } from "react";

import { useVirtualGrid } from "../hooks/useVirtualGrid";
import { MediaCard } from "./MediaCard";
import type { MediaFile } from "../utils/mediaTypes";

interface VirtualGifGridProps {
  gifs: MediaFile[];
  resetKey: string;
  minColumnWidth: number;
  retainLoadedRows: boolean;
  maxRetainedRows: number;
  staticThumbnails: boolean;
  previewOnHover: boolean;
  favoritePaths: Set<string>;
  blurTags: Set<string>;
  tagsByPath: Record<string, string[]>;
  onSelect: (gif: MediaFile) => void;
  onContextMenu: (gif: MediaFile, x: number, y: number) => void;
  onHoverChange?: (gif: MediaFile | null) => void;
}

export const VirtualGifGrid = memo(function VirtualGifGrid({
  gifs,
  resetKey,
  minColumnWidth,
  retainLoadedRows,
  maxRetainedRows,
  staticThumbnails,
  previewOnHover,
  favoritePaths,
  blurTags,
  tagsByPath,
  onSelect,
  onContextMenu,
  onHoverChange,
}: VirtualGifGridProps) {
  const { scrollRef, onScroll, layout } = useVirtualGrid<MediaFile>({
    items: gifs,
    resetKey,
    minColumnWidth,
    retainLoadedRows,
    maxRetainedRows,
  });

  return (
    <div ref={scrollRef} className="gif-grid" onScroll={onScroll}>
      <div className="gif-grid-inner" style={{ height: layout.totalHeight }}>
        {layout.visibleItems.map((entry) => {
          const media = entry.item as MediaFile;
          return (
            <MediaCard
              key={media.path}
              media={media}
              width={layout.columnWidth}
              height={layout.cardHeight}
              x={entry.x}
              y={entry.y}
              staticThumbnails={staticThumbnails}
              previewOnHover={previewOnHover}
              isFavorite={favoritePaths.has(media.path)}
              isBlurred={(tagsByPath[media.path] ?? []).some((tag) =>
                blurTags.has(tag),
              )}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onHoverChange={onHoverChange}
            />
          );
        })}
      </div>
    </div>
  );
});