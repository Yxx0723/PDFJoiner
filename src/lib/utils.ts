import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human readable byte size using binary units (1 KB = 1024 B). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 ? 0 : decimals;
  return `${value.toFixed(digits)} ${SIZE_UNITS[exponent]}`;
}

/** Short, non-technical duration label. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} 分 ${rest} 秒`;
}

export function formatPages(count: number): string {
  return `${count} 页`;
}

export function createId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * Normalises a user supplied file name into something safe to hand to the
 * download API, always ending in `.pdf`.
 */
export function sanitizeFileName(input: string, fallback = 'merged'): string {
  const base = (input || '')
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/\.(pdf|PDF)$/, '')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/, '');

  const safe = base.length > 0 ? base.slice(0, 120) : fallback;
  return `${safe}.pdf`;
}

/** Returns the trailing numeric ratio for progress bars, clamped to 0..1. */
export function ratio(value: number, total: number): number {
  if (!total) return 0;
  return Math.min(1, Math.max(0, value / total));
}

/**
 * Downloads an in-memory blob.
 *
 * The object URL is released on a timer rather than immediately: every engine
 * starts the transfer synchronously on click, but Safari has historically been
 * unforgiving about revoking too early. 5 s is long enough to be safe and short
 * enough that a burst of downloads cannot pin memory indefinitely.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Triggers a browser download for an existing object URL. */
export function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
