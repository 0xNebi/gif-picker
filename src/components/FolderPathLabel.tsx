import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface FolderPathLabelProps {
  path: string;
}

export function FolderPathLabel({ path }: FolderPathLabelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [hovered, setHovered] = useState(false);

  const measureOverflow = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const overflow = Math.max(0, text.scrollWidth - container.clientWidth);
    setOverflowPx(overflow);
  }, []);

  useEffect(() => {
    measureOverflow();
    window.addEventListener("resize", measureOverflow);
    return () => window.removeEventListener("resize", measureOverflow);
  }, [measureOverflow, path]);

  const isScrolling = hovered && overflowPx > 0;
  const durationSec = Math.min(12, Math.max(3, overflowPx / 48));

  return (
    <div
      ref={containerRef}
      className={`folder-path${isScrolling ? " is-scrolling" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        ref={textRef}
        className="folder-path__text"
        style={
          isScrolling
            ? ({
                "--folder-path-scroll": `${overflowPx}px`,
                "--folder-path-duration": `${durationSec}s`,
              } as CSSProperties)
            : undefined
        }
      >
        {path}
      </span>
    </div>
  );
}