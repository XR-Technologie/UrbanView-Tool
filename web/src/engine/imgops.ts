/* Opérations d'image rapides (flou gaussien approché par 3 flous boîte, dilatation de masque). */

/** Rayons des 3 flous boîte qui approchent un flou gaussien d'écart-type sigma. */
function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r - 1; k < r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(w - 1, x + r)] - src[row + Math.max(0, x - r - 1)];
      dst[row + x] = acc * inv;
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r - 1; k < r; k++) acc += src[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      acc += src[Math.min(h - 1, y + r) * w + x] - src[Math.max(0, y - r - 1) * w + x];
      dst[y * w + x] = acc * inv;
    }
  }
}

/** Flou gaussien (approché) d'un canal, en place. */
export function blurChannel(buf: Float32Array, w: number, h: number, sigma: number) {
  if (sigma < 0.5) return;
  const tmp = new Float32Array(buf.length);
  for (const r of boxesForGauss(sigma)) {
    const ri = Math.max(0, Math.round(r));
    if (!ri) continue;
    boxH(buf, tmp, w, h, ri);
    boxV(tmp, buf, w, h, ri);
  }
}

/** Flou gaussien d'une zone RGBA (bbox [x0,x1) × [y0,y1)) avec marge, en place. */
export function gaussianRegionRGBA(img: Uint8ClampedArray, W: number, H: number, sigma: number, x0: number, y0: number, x1: number, y1: number) {
  const m = Math.ceil(sigma * 3) + 2;
  const rx0 = Math.max(0, x0 - m), ry0 = Math.max(0, y0 - m), rx1 = Math.min(W, x1 + m), ry1 = Math.min(H, y1 + m);
  const w = rx1 - rx0, h = ry1 - ry0;
  const ch = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ch[y * w + x] = img[((ry0 + y) * W + rx0 + x) * 4 + c];
    blurChannel(ch, w, h, sigma);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[((ry0 + y) * W + rx0 + x) * 4 + c] = ch[y * w + x];
  }
}

/** Dilatation carrée d'un masque binaire (rayon r). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let cnt = 0;
    for (let k = 0; k < Math.min(w, r); k++) cnt += mask[row + k];
    for (let x = 0; x < w; x++) {
      if (x + r < w) cnt += mask[row + x + r];
      if (x - r - 1 >= 0) cnt -= mask[row + x - r - 1];
      tmp[row + x] = cnt > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let k = 0; k < Math.min(h, r); k++) cnt += tmp[k * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) cnt += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) cnt -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = cnt > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Masque adouci : 1 à l'intérieur, dégradé vers l'extérieur. */
export function softMask(mask: Uint8Array, w: number, h: number, grow: number, feather: number): Float32Array {
  const m = dilate(mask, w, h, grow);
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = m[i];
  blurChannel(f, w, h, feather);
  for (let i = 0; i < f.length; i++) if (mask[i]) f[i] = 1;
  return f;
}
