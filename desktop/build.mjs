// Assemble le processus principal Electron + le serveur Urbanview en un seul fichier.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'sharp'],
  logLevel: 'info',
});
