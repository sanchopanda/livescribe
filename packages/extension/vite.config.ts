import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import {
  CALL_PLATFORM_MATCHES,
  DEV_ONLY_MATCHES,
  PLATFORM_HOSTS,
} from './src/platform/hosts';
import path from 'path';

// Build target selects the build flavor: 'prod' (default) or 'dev' (dev-only entry points,
// separate output folder). Set via `BUILD_TARGET=dev`.
const BUILD_TARGET = process.env.BUILD_TARGET || 'prod';
const IS_DEV = BUILD_TARGET === 'dev';

// Backend target selects the URLs baked in at build time, independently of the flavor:
// 'local' (localhost) or 'prod' (skribo.ru). Defaults to local for dev, prod otherwise —
// so `BACKEND=prod BUILD_TARGET=dev` gives a dev build pointed at the live backend.
// Explicit WS_URL/API_URL/CABINET_URL still override.
const BACKEND = process.env.BACKEND || (IS_DEV ? 'local' : 'prod');
const IS_LOCAL_BACKEND = BACKEND === 'local';
const WS_URL =
  process.env.WS_URL || (IS_LOCAL_BACKEND ? 'ws://localhost:3001/ws' : 'wss://api.skribo.ru/ws');
const API_URL =
  process.env.API_URL || (IS_LOCAL_BACKEND ? 'http://localhost:3001' : 'https://api.skribo.ru');
const CABINET_URL =
  process.env.CABINET_URL || (IS_LOCAL_BACKEND ? 'http://localhost:5173' : 'https://app.skribo.ru');

const EXT_TARGET = process.env.EXT_TARGET;
// Output folder: store build → dist-store/, dev → dist-dev/ (dist-dev-prod/ when it targets
// the live backend), prod (default) → dist/.
const DEV_OUT_DIR = IS_LOCAL_BACKEND ? 'dist-dev' : 'dist-dev-prod';
const OUT_DIR =
  process.env.EXT_OUT || (EXT_TARGET === 'store' ? 'dist-store' : IS_DEV ? DEV_OUT_DIR : 'dist');

// Research probe: MAIN world at document_start, every frame, dev builds only. It has to be
// installed before the page opens its RTCPeerConnections, so it cannot be injected on demand.
const RESEARCH_PROBE_ENTRY = 'src/content/research/webrtc-probe-main.js';

// Content scripts are composed here rather than written out in public/manifest.json: the host
// lists come from src/platform/hosts.ts, the same module the runtime detector uses. Keeping
// them in the JSON is what let the manifest and the detector drift apart (Teams moved to
// teams.cloud.microsoft and only the detector was updated).
function contentScripts() {
  const scripts: any[] = [
    {
      matches: PLATFORM_HOSTS.pachca.matches,
      js: ['src/content/platforms/pachca/audio/per-track/webrtc-tracks-main.js'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
    {
      matches: PLATFORM_HOSTS.meet.matches,
      js: ['src/content/platforms/meet/audio/per-track/webrtc-tracks-main.js'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
    {
      // The widget also loads on the dev-only hosts, where there is nothing to transcribe but
      // plenty to inspect.
      matches: [...CALL_PLATFORM_MATCHES, ...(EXT_TARGET === 'store' ? [] : DEV_ONLY_MATCHES)],
      js: ['src/content/content.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ];

  if (EXT_TARGET !== 'store') {
    scripts.push({
      matches: CALL_PLATFORM_MATCHES,
      js: ['src/content/platform-research.js'],
      run_at: 'document_idle',
      all_frames: false,
      world: 'MAIN',
    });
  }

  if (IS_DEV) {
    scripts.unshift({
      matches: CALL_PLATFORM_MATCHES,
      js: [RESEARCH_PROBE_ENTRY],
      run_at: 'document_start',
      all_frames: true,
      world: 'MAIN',
    });
  }

  return scripts;
}

function activeManifest() {
  const m = JSON.parse(JSON.stringify(manifest)) as any;
  m.content_scripts = contentScripts();

  if (EXT_TARGET !== 'store') {
    if (IS_DEV) {
      // Dev flavors are loaded unpacked alongside each other — suffix the name so they are
      // told apart in chrome://extensions and in the toolbar.
      m.name = IS_LOCAL_BACKEND ? 'Skribo (dev)' : 'Skribo (dev → prod)';
    }
    return m;
  }

  m.host_permissions = [
    'https://api.skribo.ru/*',
    'https://app.skribo.ru/*',
    ...CALL_PLATFORM_MATCHES,
  ];
  // Narrow web_accessible_resources away from <all_urls> to the supported hosts,
  // so the worklet isn't exposed to every site (store review flags <all_urls> here too).
  if (Array.isArray(m.web_accessible_resources)) {
    m.web_accessible_resources = m.web_accessible_resources.map((r: any) => ({
      ...r,
      matches: CALL_PLATFORM_MATCHES,
    }));
  }
  return m;
}

export default defineConfig({
  define: {
    __WS_URL__: JSON.stringify(WS_URL),
    __API_URL__: JSON.stringify(API_URL),
    __CABINET_URL__: JSON.stringify(CABINET_URL),
    // Gates dev-only UI (the research panel). Never true in prod/store builds.
    __DEV_TOOLS__: JSON.stringify(IS_DEV),
  },
  plugins: [react(), crx({ manifest: activeManifest() as any })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@skribo/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    outDir: OUT_DIR,
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
        ...(IS_DEV
          ? { 'webrtc-probe-main': path.resolve(__dirname, 'src/content/research/webrtc-probe-main.ts') }
          : {}),
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
          if (chunkInfo.name === 'webrtc-probe-main') {
            return RESEARCH_PROBE_ENTRY;
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
