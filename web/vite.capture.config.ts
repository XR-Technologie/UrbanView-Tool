import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Appli de relevé pour téléphone (PWA autonome, chemins relatifs, hébergée en HTTPS). */
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'capture-public',
  build: {
    outDir: 'dist-capture',
    emptyOutDir: true,
    rollupOptions: { input: 'capture.html' },
  },
});
