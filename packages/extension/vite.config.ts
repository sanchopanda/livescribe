import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import path from 'path';

// Backend WebSocket URL is baked in at build time.
// Dev (default): ws://localhost:3001/ws. Prod: WS_URL=wss://api.skribo.ru/ws npm run build:extension
const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
// Backend HTTP host (email/password login) and cabinet host (session auto-detect),
// also baked in at build time. Prod: API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru npm run build:extension
const API_URL = process.env.API_URL || 'http://localhost:3001';
const CABINET_URL = process.env.CABINET_URL || 'http://localhost:5173';

const EXT_TARGET = process.env.EXT_TARGET;

function activeManifest() {
  if (EXT_TARGET !== 'store') return manifest;
  const m = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
  m.host_permissions = [
    'https://api.skribo.ru/*',
    'https://app.skribo.ru/*',
    'https://meet.google.com/*',
    'https://zoom.us/*',
    'https://*.zoom.us/*',
    'https://teams.microsoft.com/*',
    'https://*.teams.microsoft.com/*',
    'https://*.pachca.com/*',
    'https://app.pachca.com/*',
  ];
  m.content_scripts = m.content_scripts
    .filter((cs: any) => !cs.js.some((j: string) => j.includes('platform-research')))
    .map((cs: any) => ({ ...cs, matches: cs.matches.filter((p: string) => !p.includes('youtube')) }));
  // Narrow web_accessible_resources away from <all_urls> to the supported hosts,
  // so the worklet isn't exposed to every site (store review flags <all_urls> here too).
  if (Array.isArray((m as any).web_accessible_resources)) {
    (m as any).web_accessible_resources = (m as any).web_accessible_resources.map((r: any) => ({
      ...r,
      matches: m.host_permissions.filter((p: string) => !p.includes('skribo.ru')),
    }));
  }
  return m;
}

export default defineConfig({
  define: {
    __WS_URL__: JSON.stringify(WS_URL),
    __API_URL__: JSON.stringify(API_URL),
    __CABINET_URL__: JSON.stringify(CABINET_URL),
  },
  plugins: [react(), crx({ manifest: activeManifest() as any })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@skribo/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.ts'),
        content: path.resolve(__dirname, 'src/content/content.ts'),
        'pachca-webrtc-tracks-main': path.resolve(
          __dirname,
          'src/content/platforms/pachca/audio/per-track/webrtc-tracks-main.ts',
        ),
        'meet-webrtc-tracks-main': path.resolve(
          __dirname,
          'src/content/platforms/meet/audio/per-track/webrtc-tracks-main.ts',
        ),
        ...(EXT_TARGET === 'store'
          ? {}
          : { 'platform-research': path.resolve(__dirname, 'src/content/platform-research.ts') }),
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
