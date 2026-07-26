import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron loads index.html via file://, so assets must be relative paths.
  base: './',
  build: { outDir: 'dist-renderer' },
});
