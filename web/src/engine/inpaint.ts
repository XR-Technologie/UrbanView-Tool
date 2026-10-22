/*
 * Remplissage « selon le contenu » (exemplar-based, Wexler et al. + PatchMatch).
 * Pyramide multi-échelle : à chaque niveau, alternance
 *   1) recherche des patchs sources les plus proches (PatchMatch : propagation + recherche aléatoire)
 *   2) vote pondéré des patchs pour reconstruire les pixels du trou.
 */

const P = 7;
const R = 3;

interface Level { w: number; h: number; img: Float32Array; hole: Uint8Array }

let seed = 0x2f6b9a1;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};

function downsample(L: Level): Level {
  const w = L.w >> 1, h = L.h >> 1;
  const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, r = 0, g = 0, b = 0, any = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (2 * y + dy) * L.w + 2 * x + dx;
          if (L.hole[i]) { any = 1; continue; }
          n++;
          r += L.img[i * 3]; g += L.img[i * 3 + 1]; b += L.img[i * 3 + 2];
        }
      }
      const o = y * w + x;
      hole[o] = any;
      if (n) { img[o * 3] = r / n; img[o * 3 + 1] = g / n; img[o * 3 + 2] = b / n; }
    }
  }
  return { w, h, img, hole };
}

/** Remplissage initial du niveau le plus grossier : diffusion couche par couche depuis le bord du trou. */
function onionFill(L: Level) {
  const { w, h, img, hole } = L;
  const known = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < known.length; i++) { known[i] = hole[i] ? 0 : 1; if (hole[i]) remaining++; }
  while (remaining > 0) {
    const fill: number[] = [];
    const vals: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let n = 0, r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!known[j]) continue;
            n++; r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2];
          }
        }
        if (n) { fill.push(i); vals.push(r / n, g / n, b / n); }
      }
    }
    if (!fill.length) break;
    for (let k = 0; k < fill.length; k++) {
      const i = fill[k];
      img[i * 3] = vals[k * 3]; img[i * 3 + 1] = vals[k * 3 + 1]; img[i * 3 + 2] = vals[k * 3 + 2];
      known[i] = 1;
    }
    remaining -= fill.length;
  }
}

function integral(hole: Uint8Array, w: number, h: number) {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return I;
}

/** Résout un niveau (EM). nnx/nny : champ des correspondances (−1 = non initialisé). */
function solveLevel(L: Level, nnx: Int32Array, nny: Int32Array, emIters: number, pmIters: number, tick: () => void) {
  const { w, h, img, hole } = L;
  if (w <= 2 * R + 1 || h <= 2 * R + 1) return;
  const I = integral(hole, w, h);
  const W1 = w + 1;
  const valid = new Uint8Array(w * h);
  const isTarget = new Uint8Array(w * h);
  const validList: number[] = [];
  const targets: number[] = [];
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const s = I[(y + R + 1) * W1 + x + R + 1] - I[(y - R) * W1 + x + R + 1] - I[(y + R + 1) * W1 + x - R] + I[(y - R) * W1 + x - R];
      const i = y * w + x;
      if (s === 0) { valid[i] = 1; validList.push(i); } else { isTarget[i] = 1; targets.push(i); }
    }
  }
  if (!validList.length || !targets.length) return;

  for (const p of targets) {
    const q = nny[p] * w + nnx[p];
    if (nnx[p] < 0 || !valid[q]) {
      const r = validList[(rnd() * validList.length) | 0];
      nnx[p] = r % w;
      nny[p] = (r / w) | 0;
    }
  }

  const nnd = new Float32Array(w * h);
  const row3 = P * 3;
  const dist = (px: number, py: number, qx: number, qy: number, best: number) => {
    let d = 0;
    for (let dy = -R; dy <= R; dy++) {
      const a = ((py + dy) * w + px - R) * 3, b = ((qy + dy) * w + qx - R) * 3;
      for (let k = 0; k < row3; k++) { const e = img[a + k] - img[b + k]; d += e * e; }
      if (d >= best) return d;
    }
    return d;
  };

  const acc = new Float32Array(w * h * 3);
  const ws = new Float32Array(w * h);
  const maxR = Math.max(w, h);

  for (let em = 0; em < emIters; em++) {
    for (const p of targets) nnd[p] = dist(p % w, (p / w) | 0, nnx[p], nny[p], Infinity);

    for (let it = 0; it < pmIters; it++) {
      const fwd = it % 2 === 0;
      const dir = fwd ? 1 : -1;
      for (let k = 0; k < targets.length; k++) {
        const p = targets[fwd ? k : targets.length - 1 - k];
        const x = p % w, y = (p / w) | 0;
        let bx = nnx[p], by = nny[p], bd = nnd[p];
        const tryC = (qx: number, qy: number) => {
          if (qx < R || qy < R || qx >= w - R || qy >= h - R) return;
          if (!valid[qy * w + qx]) return;
          const d = dist(x, y, qx, qy, bd);
          if (d < bd) { bd = d; bx = qx; by = qy; }
        };
        const n1 = p - dir;
        if (isTarget[n1]) tryC(nnx[n1] + dir, nny[n1]);
        const n2 = p - dir * w;
        if (isTarget[n2]) tryC(nnx[n2], nny[n2] + dir);
        for (let rad = maxR; rad >= 1; rad >>= 1) {
          tryC(bx + (((rnd() * 2 - 1) * rad) | 0), by + (((rnd() * 2 - 1) * rad) | 0));
        }
        nnx[p] = bx; nny[p] = by; nnd[p] = bd;
      }
      tick();
    }

    // vote pondéré
    const sample: number[] = [];
    const step = Math.max(1, (targets.length / 2000) | 0);
    for (let k = 0; k < targets.length; k += step) sample.push(nnd[targets[k]]);
    sample.sort((a, b) => a - b);
    const sig = Math.max(1, sample[(sample.length * 0.75) | 0] || 1);
    acc.fill(0);
    ws.fill(0);
    for (const p of targets) {
      const wgt = Math.exp(-nnd[p] / (2 * sig));
      const x = p % w, y = (p / w) | 0, qx = nnx[p], qy = nny[p];
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const t = (y + dy) * w + x + dx;
          if (!hole[t]) continue;
          const s = (qy + dy) * w + qx + dx;
          acc[t * 3] += img[s * 3] * wgt;
          acc[t * 3 + 1] += img[s * 3 + 1] * wgt;
          acc[t * 3 + 2] += img[s * 3 + 2] * wgt;
          ws[t] += wgt;
        }
      }
    }
    for (let i = 0; i < ws.length; i++) {
      if (!hole[i] || ws[i] <= 0) continue;
      img[i * 3] = acc[i * 3] / ws[i];
      img[i * 3 + 1] = acc[i * 3 + 1] / ws[i];
      img[i * 3 + 2] = acc[i * 3 + 2] / ws[i];
    }
  }
}

function upsample(c: Level, cnx: Int32Array, cny: Int32Array, f: Level) {
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      if (!f.hole[i]) continue;
      const ci = Math.min(y >> 1, c.h - 1) * c.w + Math.min(x >> 1, c.w - 1);
      f.img[i * 3] = c.img[ci * 3]; f.img[i * 3 + 1] = c.img[ci * 3 + 1]; f.img[i * 3 + 2] = c.img[ci * 3 + 2];
    }
  }
  const nnx = new Int32Array(f.w * f.h).fill(-1), nny = new Int32Array(f.w * f.h).fill(-1);
  for (let y = R; y < f.h - R; y++) {
    for (let x = R; x < f.w - R; x++) {
      const ci = Math.min(y >> 1, c.h - 1) * c.w + Math.min(x >> 1, c.w - 1);
      if (cnx[ci] < 0) continue;
      const i = y * f.w + x;
      nnx[i] = Math.min(f.w - R - 1, Math.max(R, cnx[ci] * 2 + (x & 1)));
      nny[i] = Math.min(f.h - R - 1, Math.max(R, cny[ci] * 2 + (y & 1)));
    }
  }
  return { nnx, nny };
}

/**
 * Remplit les pixels `hole` de `img` (RGB float, w×h) à partir du reste de l'image. Modifie `img` en place.
 */
export function inpaint(img: Float32Array, hole: Uint8Array, w: number, h: number, onProgress?: (p: number) => void) {
  const levels: Level[] = [{ w, h, img, hole }];
  while (levels.length < 8) {
    const L = levels[levels.length - 1];
    if (Math.min(L.w, L.h) < 6 * P) break;
    const D = downsample(L);
    levels.push(D);
    if (Math.max(D.w, D.h) <= 64) break;
  }
  const top = levels.length - 1;
  onionFill(levels[top]);

  const plan = levels.map((L, i) => ({ em: i === 0 ? 2 : i === top ? 6 : 4, pm: i === 0 ? 3 : 4, cost: L.w * L.h }));
  const total = plan.reduce((a, p) => a + p.em * p.pm * p.cost, 0) || 1;
  let done = 0;

  let nnx = new Int32Array(levels[top].w * levels[top].h).fill(-1);
  let nny = new Int32Array(levels[top].w * levels[top].h).fill(-1);
  for (let li = top; li >= 0; li--) {
    const L = levels[li];
    if (li < top) ({ nnx, nny } = upsample(levels[li + 1], nnx, nny, L));
    const { em, pm, cost } = plan[li];
    solveLevel(L, nnx, nny, em, pm, () => { done += cost; onProgress?.(Math.min(1, done / total)); });
  }
  onProgress?.(1);
}
