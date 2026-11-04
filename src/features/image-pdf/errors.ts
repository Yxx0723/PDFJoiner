/** Errors raised by the images → PDF pipeline. */

export type ImagePdfErrorCode =
  | 'no-images'
  | 'unsupported'
  | 'decode-failed'
  | 'encode-failed'
  | 'too-large'
  | 'worker-crashed'
  | 'verify-failed'
  | 'unknown';

export class ImagePdfError extends Error {
  readonly code: ImagePdfErrorCode;
  readonly fileName?: string;

  constructor(
    code: ImagePdfErrorCode,
    message: string,
    options: { fileName?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ImagePdfError';
    this.code = code;
    this.fileName = options.fileName;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toJSON() {
    return { code: this.code, message: this.message, fileName: this.fileName };
  }
}

export class ImagePdfCancelledError extends Error {
  readonly code = 'cancelled' as const;

  constructor(message = '已取消生成。') {
    super(message);
    this.name = 'ImagePdfCancelledError';
  }
}

export function asImagePdfError(error: unknown, fallbackMessage: string): ImagePdfError {
  if (error instanceof ImagePdfError) return error;
  return new ImagePdfError('unknown', fallbackMessage, { cause: error });
}
