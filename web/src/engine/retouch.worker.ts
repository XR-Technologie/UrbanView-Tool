/*
 * Worker de retouche : garde le panorama pleine résolution en mémoire,
 * rend des vues en perspective, applique flou / effacement dans la vue
 * puis reprojette le résultat dans l'image équirectangulaire.
 */
import { DEG, PI, TAU, basis, clamp } from './math';
import { inpaint } from './inpaint';
import { dilate, gaussianRegionRGBA, softMask } from './imgops';

interface View { yaw: number; pitch: number; fov: number }
interface Patch { x0: number; y0: number; w: number; h: number; data: Uint8ClampedArray }

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let EW = 0;
let EH = 0;
let eq = new Uint8ClampedArray(0);
let history: Patch[] = [];
const MAX_HISTORY_BYTES = 320 * 1024 * 1024;

const reply = (msg: object, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);
const progress = (p: number) => reply({ type: 'progress', p });

/** Rendu perspective (bilinéaire, raccord 360° géré). */
function renderPersp(view: View, W: number, H: number) {
  const out = new Uint8ClampedArray(W * H * 4);
  const t = Math.tan((view.fov * DEG) / 2), a = W / H;
  const { R, U, F } = basis(view.yaw, view.pitch);
  for (let j = 0; j < H; j++) {
    const py = (1 - ((j + 0.5) / H) * 2) * t;
    for (let i = 0; i < W; i++) {
      const px = (((i + 0.5) / W) * 2 - 1) * a * t;
      let dx = R[0] * px + U[0] * py + F[0];
      let dy = R[1] * px + U[1] * py + F[1];
      let dz = R[2] * px + U[2] * py + F[2];
      const l = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx *= l; dy *= l; dz *= l;
      const u = (Math.atan2(dx, -dz) / TAU + 0.5) * EW - 0.5;
      const v = (Math.acos(clamp(dy, -1, 1)) / PI) * EH - 0.5;
      let x0 = Math.floor(u), y0 = Math.floor(v);
      const fx = u - x0, fy = v - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      x0 = ((x0 % EW) + EW) % EW; x1 = ((x1 % EW) + EW) % EW;
      y0 = clamp(y0, 0, EH - 1); y1 = clamp(y1, 0, EH - 1);
      const a00 = (y0 * EW + x0) * 4, a10 = (y0 * EW + x1) * 4, a01 = (y1 * EW + x0) * 4, a11 = (y1 * EW + x1) * 4;
      const o = (j * W + i) * 4;
      for (let c = 0; c < 3; c++) {
        const top = eq[a00 + c] + (eq[a10 + c] - eq[a00 + c]) * fx;
        const bot = eq[a01 + c] + (eq[a11 + c] - eq[a01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

function pushHistory(x0: number, y0: number, w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(eq.subarray(((y0 + y) * EW + x0) * 4, ((y0 + y) * EW + x0 + w) * 4), y * w * 4);
  history.push({ x0, y0, w, h, data });
  let bytes = history.reduce((s, p) => s + p.data.byteLength, 0);
  while (bytes > MAX_HISTORY_BYTES && history.length > 1) bytes -= history.shift()!.data.byteLength;
}

function restore(p: Patch) {
  for (let y = 0; y < p.h; y++) eq.set(p.data.subarray(y * p.w * 4, (y + 1) * p.w * 4), ((p.y0 + y) * EW + p.x0) * 4);
}

/** Reprojette la vue traitée dans l'équirectangulaire, pondérée par `alpha`. */
function reproject(view: View, W: number, H: number, proc: Uint8ClampedArray, alpha: Float32Array) {
  const t = Math.tan((view.fov * DEG) / 2), a = W / H;
  const { R, U, F } = basis(view.yaw, view.pitch);

  // zone touchée dans l'équirectangulaire
  const BINS = 720;
  const bins = new Uint8Array(BINS);
  let vmin = EH, vmax = -1;
  for (let j = 0; j < H; j += 2) {
    const py = (1 - ((j + 0.5) / H) * 2) * t;
    for (let i = 0; i < W; i += 2) {
      if (alpha[j * W + i] <= 0.003) continue;
      const px = (((i + 0.5) / W) * 2 - 1) * a * t;
      const dx = R[0] * px + U[0] * py + F[0], dy = R[1] * px + U[1] * py + F[1], dz = R[2] * px + U[2] * py + F[2];
      const l = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const u = Math.atan2(dx * l, -dz * l) / TAU + 0.5;
      const v = (Math.acos(clamp(dy * l, -1, 1)) / PI) * EH;
      bins[Math.min(BINS - 1, Math.floor(u * BINS))] = 1;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
  }
  if (vmax < 0) return;
  const occ: number[] = [];
  for (let s = 0; s < BINS; s++) if (bins[s]) occ.push(s);
  let gapLen = -1, gapAfter = 0;
  for (let k = 0; k < occ.length; k++) {
    const len = ((occ[(k + 1) % occ.length] - occ[k] + BINS) % BINS) || BINS;
    if (len > gapLen) { gapLen = len; gapAfter = k; }
  }
  const start = occ[(gapAfter + 1) % occ.length], end = occ[gapAfter];
  let xa = 0, xb = EW;
  if (gapLen >= 8 && start <= end) {
    xa = Math.max(0, Math.floor(((start - 2) / BINS) * EW));
    xb = Math.min(EW, Math.ceil(((end + 3) / BINS) * EW));
  }
  const ya = Math.max(0, Math.floor(vmin) - 4), yb = Math.min(EH, Math.ceil(vmax) + 5);
  pushHistory(xa, ya, xb - xa, yb - ya);

  const cs = new Float32Array(xb - xa), sn = new Float32Array(xb - xa);
  for (let x = xa; x < xb; x++) {
    const yaw = ((x + 0.5) / EW) * TAU - PI;
    cs[x - xa] = Math.cos(yaw);
    sn[x - xa] = Math.sin(yaw);
  }
  for (let y = ya; y < yb; y++) {
    const pitch = PI / 2 - ((y + 0.5) / EH) * PI;
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    for (let x = xa; x < xb; x++) {
      const dx = sn[x - xa] * cp, dy = sp, dz = -cs[x - xa] * cp;
      const z = dx * F[0] + dy * F[1] + dz * F[2];
      if (z < 1e-3) continue;
      const sx = ((dx * R[0] + dy * R[1] + dz * R[2]) / z / (t * a) + 1) * 0.5 * W - 0.5;
      const sy = (1 - (dx * U[0] + dy * U[1] + dz * U[2]) / z / t) * 0.5 * H - 0.5;
      if (sx < 0 || sy < 0 || sx > W - 1 || sy > H - 1) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const i00 = y0 * W + x0, i10 = y0 * W + x1, i01 = y1 * W + x0, i11 = y1 * W + x1;
      const al = (alpha[i00] * (1 - fx) + alpha[i10] * fx) * (1 - fy) + (alpha[i01] * (1 - fx) + alpha[i11] * fx) * fy;
      if (al < 0.003) continue;
      const o = (y * EW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = proc[i00 * 4 + c] * (1 - fx) + proc[i10 * 4 + c] * fx;
        const bot = proc[i01 * 4 + c] * (1 - fx) + proc[i11 * 4 + c] * fx;
        eq[o + c] = eq[o + c] * (1 - al) + (top * (1 - fy) + bot * fy) * al;
      }
    }
  }
}

function apply(view: View, W: number, H: number, mode: 'blur' | 'erase', mask: Uint8Array, sigma: number) {
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  if (bx1 < 0) return;
  progress(0.02);
  const proc = renderPersp(view, W, H);
  let alpha: Float32Array;

  if (mode === 'blur') {
    gaussianRegionRGBA(proc, W, H, sigma, bx0, by0, bx1 + 1, by1 + 1);
    alpha = softMask(mask, W, H, 1, 2.5);
    progress(0.6);
  } else {
    const hard = dilate(mask, W, H, 3);
    const m = Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.9) + 24;
    const cx0 = Math.max(0, bx0 - m), cy0 = Math.max(0, by0 - m), cx1 = Math.min(W, bx1 + 1 + m), cy1 = Math.min(H, by1 + 1 + m);
    const cw = cx1 - cx0, ch = cy1 - cy0;
    const img = new Float32Array(cw * ch * 3), hole = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const s = (cy0 + y) * W + cx0 + x, d = y * cw + x;
        img[d * 3] = proc[s * 4]; img[d * 3 + 1] = proc[s * 4 + 1]; img[d * 3 + 2] = proc[s * 4 + 2];
        hole[d] = hard[s];
      }
    }
    inpaint(img, hole, cw, ch, p => progress(0.05 + p * 0.85));
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const d = y * cw + x;
        if (!hole[d]) continue;
        const s = (cy0 + y) * W + cx0 + x;
        proc[s * 4] = img[d * 3]; proc[s * 4 + 1] = img[d * 3 + 1]; proc[s * 4 + 2] = img[d * 3 + 2];
      }
    }
    alpha = softMask(hard, W, H, 1, 1.5);
  }
  progress(0.92);
  reproject(view, W, H, proc, alpha);
  progress(1);
}

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'load': {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error('Photo introuvable');
        const bmp = await createImageBitmap(await res.blob());
        EW = bmp.width;
        EH = bmp.height;
        const c = new OffscreenCanvas(EW, EH);
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(bmp, 0, 0);
        bmp.close();
        eq = g.getImageData(0, 0, EW, EH).data;
        history = [];
        reply({ id: m.id, w: EW, h: EH });
        break;
      }
      case 'render': {
        const out = renderPersp(m.view, m.w, m.h);
        reply({ id: m.id, w: m.w, h: m.h, buf: out.buffer }, [out.buffer]);
        break;
      }
      case 'apply': {
        apply(m.view, m.w, m.h, m.mode, new Uint8Array(m.mask), m.sigma);
        reply({ id: m.id, undo: history.length });
        break;
      }
      case 'undo': {
        const p = history.pop();
        if (p) restore(p);
        reply({ id: m.id, undo: history.length });
        break;
      }
      case 'encode': {
        const c = new OffscreenCanvas(EW, EH);
        c.getContext('2d')!.putImageData(new ImageData(eq, EW, EH), 0, 0);
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
        reply({ id: m.id, blob });
        break;
      }
    }
  } catch (err) {
    reply({ id: m.id, error: (err as Error).message || 'Erreur de traitement' });
  }
};
