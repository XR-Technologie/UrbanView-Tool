import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIA_DIR } from './config.js';

sharp.cache(false);

/** Résolutions générées pour chaque panorama (largeur max). */
export const VARIANTS = { full: 8192, mid: 4096, low: 1536 } as const;
const THUMB = { w: 640, h: 360 };

export const mediaDir = (id: string) => path.join(MEDIA_DIR, id);
export const isSafeId = (id: string) => /^[\w-]{6,40}$/.test(id);

/**
 * Optimise un panorama équirectangulaire :
 * full (≤8192) · mid (≤4096, mobile) · low (≤1536, affichage instantané) · thumb.
 */
export async function processPanorama(id: string, input: Buffer) {
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });

  const src = sharp(input, { limitInputPixels: false, failOn: 'none' }).rotate();
  const meta = await src.metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width];
  if (!width || !height) throw new Error('Image illisible');

  const fullW = Math.min(width, VARIANTS.full);
  const fullPath = path.join(dir, 'full.jpg');
  await src.clone().resize({ width: fullW }).jpeg({ quality: 88, mozjpeg: true }).toFile(fullPath);

  const from = () => sharp(fullPath, { limitInputPixels: false });
  await from().resize({ width: Math.min(fullW, VARIANTS.mid) }).jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(dir, 'mid.jpg'));
  await from().resize({ width: Math.min(fullW, VARIANTS.low) }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(dir, 'low.jpg'));
  await makeThumb(id, 0, 0);

  return { width: fullW, height: Math.round(height * fullW / width) };
}

/** Vignette 16:9 recadrée autour d'une direction (yaw / pitch en radians). */
export async function makeThumb(id: string, yaw: number, pitch: number) {
  const src = path.join(mediaDir(id), 'mid.jpg');
  const { width: W = 0, height: H = 0 } = await sharp(src).metadata();
  const cw = Math.round(W * 0.28);
  const ch = Math.min(H, Math.round(cw * THUMB.h / THUMB.w));
  const norm = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const cx = (norm / (2 * Math.PI) + 0.5) * W;
  const cy = (0.5 - pitch / Math.PI) * H;
  const left = Math.round(cx - cw / 2) + cw;                 // +cw : bande étendue pour le raccord 360°
  const top = Math.max(0, Math.min(H - ch, Math.round(cy - ch / 2)));
  const strip = await sharp(src).extend({ left: cw, right: cw, extendWith: 'repeat' }).toBuffer();
  await sharp(strip)
    .extract({ left: Math.max(0, Math.min(W + cw, left)), top, width: cw, height: ch })
    .resize(THUMB.w, THUMB.h)
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(mediaDir(id), 'thumb.jpg'));
}

export async function removeMedia(id: string) {
  if (!isSafeId(id)) return;
  await fs.rm(mediaDir(id), { recursive: true, force: true });
}
