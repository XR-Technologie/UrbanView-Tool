import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Lecteur autonome utilisé par l'export ZIP (chemins relatifs). */
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-player',
    emptyOutDir: true,
    rollupOptions: { input: 'player.html' },
  },
});
