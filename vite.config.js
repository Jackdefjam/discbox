import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' }
  }
});
