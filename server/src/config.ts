import path from 'node:path';

export interface ServerPaths { dataDir: string; webDist: string; playerDist: string }

/** Chemins du serveur (modifiables avant démarrage, ex. par l'application de bureau). */
export const cfg = {
  dataDir: process.env.UV_DATA_DIR || path.resolve('data'),
  webDist: process.env.UV_WEB_DIST || path.resolve('web/dist'),
  playerDist: process.env.UV_PLAYER_DIST || path.resolve('web/dist-player'),
  get mediaDir() { return path.join(this.dataDir, 'media'); },
};

export function configure(p: Partial<ServerPaths>) {
  for (const [k, v] of Object.entries(p)) if (v) cfg[k as keyof ServerPaths] = v;
}
