/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

/** Chromium ImageDecoder API (available in WebView2). */
interface ImageDecoderInit {
  data: BufferSource;
  type: string;
}

interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

interface ImageDecodeResult {
  image: VideoFrame;
  complete: boolean;
}

declare class ImageDecoder {
  constructor(init: ImageDecoderInit);
  decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>;
  close(): void;
}