import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import path from 'path';

export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as any })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@livescribe/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.ts'),
        content: path.resolve(__dirname, 'src/content/content.ts'),
        'platform-research': path.resolve(__dirname, 'src/content/platform-research.ts'),
        'pachca-webrtc-tracks-main': path.resolve(
          __dirname,
          'src/content/platforms/pachca/audio/per-track/webrtc-tracks-main.ts',
        ),
        'meet-webrtc-tracks-main': path.resolve(
          __dirname,
          'src/content/platforms/meet/audio/per-track/webrtc-tracks-main.ts',
        ),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'offscreen') {
            return 'offscreen.js';
          }
          if (chunkInfo.name === 'content') {
            return 'src/content/content.js';
          }
          if (chunkInfo.name === 'platform-research') {
            return 'src/content/platform-research.js';
          }
          if (chunkInfo.name === 'pachca-webrtc-tracks-main') {
            return 'src/content/platforms/pachca/audio/per-track/webrtc-tracks-main.js';
          }
          if (chunkInfo.name === 'meet-webrtc-tracks-main') {
            return 'src/content/platforms/meet/audio/per-track/webrtc-tracks-main.js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
