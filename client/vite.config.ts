import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    watch: {
      // Windows 下编辑器临时文件会触发 EBUSY 崩溃，忽略之
      ignored: ['**/*.tmp', '**/*.tmpdir/**', '**/.index.ts.*/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
