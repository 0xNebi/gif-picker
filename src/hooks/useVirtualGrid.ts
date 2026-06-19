import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GRID_GAP = 14;
const CARD_ASPECT = 4 / 3;
const OVERSCAN_ROWS = 4;
const DEFAULT_MAX_RETAINED_ROWS = 60;

export interface VirtualGridItem<T> {
  item: T;
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
}

export interface VirtualGridLayout {
  columns: number;
  columnWidth: number;
  cardHeight: number;
  rowHeight: number;
  rowCount: number;
  totalHeight: number;
  visibleItems: VirtualGridItem<unknown>[];
}

interface UseVirtualGridOptions<T> {
  items: T[];
  resetKey: string;
  minColumnWidth: number;
  retainLoadedRows: boolean;
  maxRetainedRows?: number;
}

export function useVirtualGrid<T>({
  items,
  resetKey,
  minColumnWidth,
  retainLoadedRows,
  maxRetainedRows = DEFAULT_MAX_RETAINED_ROWS,
}: UseVirtualGridOptions<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const retainedRowsRef = useRef<Set<number>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setGridWidth(Math.max(0, el.clientWidth - 16));
    setViewportHeight(el.clientHeight);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
    retainedRowsRef.current.clear();
  }, [resetKey]);

  const layout = useMemo((): VirtualGridLayout => {
    const columns = Math.max(
      1,
      Math.floor((gridWidth + GRID_GAP) / (minColumnWidth + GRID_GAP)),
    );
    const columnWidth =
      columns > 0
        ? (gridWidth - GRID_GAP * (columns - 1)) / columns
        : minColumnWidth;
    const cardHeight = columnWidth / CARD_ASPECT;
    const rowHeight = cardHeight + GRID_GAP;
    const rowCount = items.length > 0 ? Math.ceil(items.length / columns) : 0;
    const totalHeight = rowCount > 0 ? rowCount * rowHeight - GRID_GAP : 0;

    const startRow = Math.max(
      0,
      Math.floor(scrollTop / Math.max(rowHeight, 1)) - OVERSCAN_ROWS,
    );
    const endRow = Math.min(
      rowCount,
      Math.ceil((scrollTop + viewportHeight) / Math.max(rowHeight, 1)) +
        OVERSCAN_ROWS,
    );

    for (let row = startRow; row < endRow; row += 1) {
      retainedRowsRef.current.add(row);
    }

    if (retainLoadedRows && retainedRowsRef.current.size > maxRetainedRows) {
      const rows = [...retainedRowsRef.current].sort((a, b) => a - b);
      const excess = rows.length - maxRetainedRows;
      for (let i = 0; i < excess; i += 1) {
        retainedRowsRef.current.delete(rows[i]);
      }
    }

    const rowsToRender = new Set<number>();
    for (let row = startRow; row < endRow; row += 1) {
      rowsToRender.add(row);
    }
    if (retainLoadedRows) {
      for (const row of retainedRowsRef.current) {
        rowsToRender.add(row);
      }
    }

    const visibleItems: VirtualGridItem<T>[] = [];
    const sortedRows = [...rowsToRender].sort((a, b) => a - b);
    for (const row of sortedRows) {
      for (let col = 0; col < columns; col += 1) {
        const index = row * columns + col;
        if (index >= items.length) break;
        visibleItems.push({
          item: items[index],
          index,
          row,
          col,
          x: col * (columnWidth + GRID_GAP),
          y: row * rowHeight,
        });
      }
    }

    return {
      columns,
      columnWidth,
      cardHeight,
      rowHeight,
      rowCount,
      totalHeight,
      visibleItems: visibleItems as VirtualGridItem<unknown>[],
    };
  }, [gridWidth, items, maxRetainedRows, minColumnWidth, retainLoadedRows, scrollTop, viewportHeight]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  return {
    scrollRef,
    onScroll,
    layout,
  };
}