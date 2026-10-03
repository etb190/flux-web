import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Dev-only CSP relaxation: Vite HMR needs ws:// and injects inline
// style/script tags (react-refresh). The production CSP stays strict.
function fluxCspDev() {
  return {
    name: 'flux-csp-dev',
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws: wss:");
    }
  };
}

// The Express backend (server/index.js) exposes /api/* and the media proxy.
// In dev, Vite proxies those to the Node server so the page stays same-origin.
const API_TARGET = process.env.FLUX_API_TARGET || 'http://localhost:5175';

export default defineConfig({
  root: resolve(root, 'client'),
  plugins: [react(), tailwindcss(), fluxCspDev()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true }
    }
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true }
    }
  }
});
