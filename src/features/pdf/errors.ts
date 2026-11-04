/**
 * Error types shared by the merge engine, the worker bridge and the UI.
 *
 * Kept free of pdf-lib imports so the main bundle never has to pull the PDF
 * engine in just to render an error message.
 */

export type PdfEngineErrorCode =
  | 'encrypted'
  | 'invalid-pdf'
  | 'empty-document'
  | 'page-out-of-range'
  | 'out-of-memory'
  | 'verify-failed'
  | 'empty-plan'
  | 'cancelled'
  | 'worker-crashed'
  | 'unknown';

export class PdfEngineError extends Error {
  readonly code: PdfEngineErrorCode;
  readonly fileName?: string;

  constructor(
    code: PdfEngineErrorCode,
    message: string,
    options: { fileName?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'PdfEngineError';
    this.code = code;
    this.fileName = options.fileName;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toJSON() {
    return { code: this.code, message: this.message, fileName: this.fileName };
  }
}

export class MergeCancelledError extends Error {
  readonly code = 'cancelled' as const;
  constructor(message = '合并已取消。') {
    super(message);
    this.name = 'MergeCancelledError';
  }
}
