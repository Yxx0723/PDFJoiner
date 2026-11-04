/**
 * Decoding an image blob into something `drawImage` accepts.
 *
 * `createImageBitmap` is preferred: it decodes off the main thread, respects
 * EXIF orientation by default and transfers cheaply into a worker. Browsers
 * without it (or that reject a particular file) fall back to an `<img>` with an
 * object URL — main thread only, which is exactly why the engine falls back to
 * the main thread as a whole in that case.
 */

import { ImagePdfError } from './errors';

export interface LoadedSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Frees the bitmap / object URL. Always call this, including on failure. */
  release: () => void;
}

export async function loadImageSource(blob: Blob): Promise<LoadedSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through: some Safari builds reject the options bag, and a broken
      // file may still be reported more usefully by the <img> path.
    }
  }

  if (typeof document === 'undefined') {
    throw new ImagePdfError('decode-failed', '当前环境不支持解码该图片。');
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new ImagePdfError('decode-failed', '图片解码失败。', { cause: error });
  }
}
