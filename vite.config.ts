import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The merge engine runs in a module worker; Vite must emit it as ESM.
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          // pdf.js is only needed once a user opens the page preview; keeping it
          // in its own chunk keeps the first paint small. pdf-lib lives entirely
          // inside the merge worker, so it needs no entry here.
          pdfjs: ['pdfjs-dist'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
