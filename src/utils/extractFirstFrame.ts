import { isVideoPath, mimeForPath } from "./mediaTypes";

const MAX_CONCURRENT = 3;
const THUMBNAIL_MAX_DIM = 280;

/** In-memory thumbnail store — primary RAM consumer (WebP data URLs). */
const cache = new Map<string, string>();
const sizeByPath = new Map<string, number>();

let memoryBudgetBytes = 128 * 1024 * 1024;

type QueueItem = {
  path: string;
  assetUrl: string;
  isVideo: boolean;
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
};

const queue: QueueItem[] = [];
let activeCount = 0;

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

function touchCacheEntry(path: string): void {
  const value = cache.get(path);
  if (!value) return;
  cache.delete(path);
  cache.set(path, value);
}

function enforceMemoryBudget(): void {
  if (!Number.isFinite(memoryBudgetBytes)) return;

  let total = 0;
  for (const bytes of sizeByPath.values()) {
    total += bytes;
  }

  while (total > memoryBudgetBytes && cache.size > 0) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    const bytes = sizeByPath.get(oldest) ?? 0;
    cache.delete(oldest);
    sizeByPath.delete(oldest);
    total -= bytes;
  }
}

export function setThumbnailMemoryBudgetMb(mb: number): void {
  memoryBudgetBytes = mb <= 0 ? Number.POSITIVE_INFINITY : mb * 1024 * 1024;
  enforceMemoryBudget();
}

function isImageDecoderSupported(): boolean {
  return typeof ImageDecoder !== "undefined";
}

async function decodeImageFirstFrame(assetUrl: string, mimeType: string): Promise<string> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset (${response.status})`);
  }

  const blob = await response.blob();
  const type = blob.type || mimeType;
  const buffer = await blob.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type });

  try {
    const { image } = await decoder.decode({ frameIndex: 0 });
    const scale = Math.min(
      1,
      THUMBNAIL_MAX_DIM / Math.max(image.displayWidth, image.displayHeight, 1),
    );
    const width = Math.max(1, Math.round(image.displayWidth * scale));
    const height = Math.max(1, Math.round(image.displayHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      image.close();
      throw new Error("Canvas 2D context unavailable");
    }

    ctx.drawImage(image, 0, 0, width, height);
    image.close();

    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    decoder.close();
  }
}

function captureVideoFrame(video: HTMLVideoElement): string {
  const scale = Math.min(
    1,
    THUMBNAIL_MAX_DIM / Math.max(video.videoWidth, video.videoHeight, 1),
  );
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.82);
}

async function decodeVideoFirstFrame(assetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      video.removeAttribute("src");
      video.load();
      handler();
    };

    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error("Video thumbnail decode timed out")));
    }, 12_000);

    video.onerror = () => {
      finish(() => reject(new Error("Video thumbnail decode failed")));
    };

    const drawFrame = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        finish(() => reject(new Error("Video has no displayable dimensions")));
        return;
      }
      try {
        const dataUrl = captureVideoFrame(video);
        finish(() => resolve(dataUrl));
      } catch (error) {
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
      }
    };

    video.onloadedmetadata = () => {
      const seekTarget =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.1, video.duration * 0.01)
          : 0;

      if (Math.abs(video.currentTime - seekTarget) < 0.001) {
        drawFrame();
        return;
      }

      video.addEventListener("seeked", drawFrame, { once: true });
      video.currentTime = seekTarget;
    };

    video.src = assetUrl;
    video.load();
  });
}

async function decodeFirstFrame(
  path: string,
  assetUrl: string,
  isVideo: boolean,
): Promise<string> {
  if (isVideo) {
    return decodeVideoFirstFrame(assetUrl);
  }
  if (!isImageDecoderSupported()) {
    throw new Error("ImageDecoder API is not available");
  }
  return decodeImageFirstFrame(assetUrl, mimeForPath(path));
}

function storeInCache(path: string, dataUrl: string): void {
  if (cache.has(path)) {
    cache.delete(path);
    sizeByPath.delete(path);
  }
  const bytes = estimateDataUrlBytes(dataUrl);
  cache.set(path, dataUrl);
  sizeByPath.set(path, bytes);
  enforceMemoryBudget();
}

function drainQueue() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    activeCount += 1;
    void (async () => {
      try {
        const dataUrl = await decodeFirstFrame(item.path, item.assetUrl, item.isVideo);
        storeInCache(item.path, dataUrl);
        item.resolve(dataUrl);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        activeCount -= 1;
        drainQueue();
      }
    })();
  }
}

export function getCachedThumbnail(path: string): string | undefined {
  const cached = cache.get(path);
  if (cached) touchCacheEntry(path);
  return cached;
}

export function clearThumbnailCache(): void {
  cache.clear();
  sizeByPath.clear();
}

const inflight = new Map<string, Promise<string>>();

export function requestThumbnail(path: string, assetUrl: string): Promise<string> {
  const cached = getCachedThumbnail(path);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = new Promise<string>((resolve, reject) => {
    queue.push({
      path,
      assetUrl,
      isVideo: isVideoPath(path),
      resolve,
      reject,
    });
    drainQueue();
  }).finally(() => {
    inflight.delete(path);
  });

  inflight.set(path, promise);
  return promise;
}