import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@qualia/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // /callback：Spotify 後台登記的 redirect 路徑，由伺服器處理（只在 SPOTIFY_ENABLED=true 時存在）。
    proxy: { '/api': 'http://127.0.0.1:8080', '/callback': 'http://127.0.0.1:8080' },
  },
  build: { target: 'es2022', sourcemap: false },
});
