import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

/**
 * pdf.js 4.x calls `Promise.withResolvers` (Chrome 119+, Safari 17.4+).
 * A two-line shim keeps the preview working on slightly older browsers.
 */
if (typeof Promise !== 'undefined' && typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as Record<string, unknown>).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/**
 * Dropping a PDF *outside* the drop zone would otherwise navigate the tab to
 * the file and destroy the in-memory task. Swallow those events globally.
 */
['dragover', 'drop'].forEach((type) => {
  window.addEventListener(
    type,
    (event: Event) => {
      const dragEvent = event as DragEvent;
      if (dragEvent.dataTransfer?.types?.includes('Files')) event.preventDefault();
    },
    false,
  );
});

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
