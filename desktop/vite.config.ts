import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Assets load from disk in the packaged app (file://), so paths stay relative.
  base: './',
  resolve: {
    // import.meta.dirname rather than __dirname: Vite 8 loads this config
    // natively as ESM.
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // The logo lives once, at the repo root, and is shared by the README,
      // the app icon and the renderer.
      '@assets': path.resolve(import.meta.dirname, '../assets'),
    },
  },
  server: {
    // IPv4 explicitly. Left to itself Vite binds [::1] only, and the Wails
    // asset server proxies over tcp4 -- which is a connection refused with
    // nothing on either side saying why.
    host: '127.0.0.1',
    port: 3000,
    // The app loads localhost:3000 and the dev script waits on it, so a Vite
    // that quietly moved to the next free port would leave the window pointing
    // at nothing. Fail loudly instead, and say which port is taken.
    strictPort: true,
    // The shared assets directory sits above this project root.
    fs: { allow: ['..'] },
  },
  build: {
    target: 'esnext',
    // Written where Go embeds it from, not beside these sources: the output is
    // not part of this project, it is what the app serves.
    outDir: '../internal/window/assets/dist',
    emptyOutDir: true,
    // Vite 8 minifies with oxc by default; naming esbuild now needs it
    // installed separately.
    sourcemap: false,
  },
});
