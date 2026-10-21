import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '../..');
export const DATA_DIR = process.env.UV_DATA_DIR || path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const PLAYER_DIST = path.join(ROOT, 'web', 'dist-player');
export const PORT = Number(process.env.PORT || 3360);
export const HOST = process.env.HOST || '0.0.0.0';
