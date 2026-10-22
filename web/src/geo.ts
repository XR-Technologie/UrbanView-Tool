import { DEG, PI, normAng } from './engine/math';
import { isLink, sceneById, uid, type LinkHotspot, type Scene, type TourData } from './types';

type LatLng = { lat: number; lng: number };

/** Distance en mètres (haversine). */
export function distance(a: LatLng, b: LatLng) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG, dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cap géographique de a vers b, en degrés (0 = nord, sens horaire). */
export function bearing(a: LatLng, b: LatLng) {
  const y = Math.sin((b.lng - a.lng) * DEG) * Math.cos(b.lat * DEG);
  const x = Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) - Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lng - a.lng) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Position décalée de `east` / `north` mètres (approximation locale, précise à l'échelle d'un bâtiment). */
export function offsetMeters(o: LatLng, east: number, north: number): LatLng {
  const R = 6371008.8;
  return {
    lat: o.lat + north / R / DEG,
    lng: o.lng + east / (R * Math.cos(o.lat * DEG)) / DEG,
  };
}

/**
 * Cap déduit des ponts : pour chaque lien vers une scène placée,
 * cap ≈ (direction géographique du lien) − (direction du lien dans la photo).
 */
export function autoHeading(d: TourData, s: Scene): number | null {
  if (!s.geo) return null;
  let sx = 0, sy = 0, n = 0;
  for (const h of s.hotspots) {
    if (!isLink(h)) continue;
    const t = sceneById(d, h.target);
    if (!t?.geo || t.id === s.id || distance(s.geo, t.geo) < 0.3) continue;
    const est = (bearing(s.geo, t.geo) - h.yaw / DEG) * DEG;
    sx += Math.cos(est); sy += Math.sin(est); n++;
  }
  return n ? norm360(Math.atan2(sy, sx) / DEG) : null;
}

/** Cap retenu : réglage manuel, sinon automatique. */
export const headingOf = (d: TourData, s: Scene): number | null => s.geo?.heading ?? autoHeading(d, s);

const linked = (a: Scene, bId: string) => a.hotspots.some(h => isLink(h) && h.target === bId);

/**
 * Crée un pont a ↔ b : ajoute les points de passage manquants dans les deux photos,
 * orientés vers la position géographique de l'autre photo. Modifie `d` en place.
 */
export function addBridge(d: TourData, aId: string, bId: string) {
  const a = sceneById(d, aId), b = sceneById(d, bId);
  if (!a || !b || a === b || !a.geo || !b.geo) return;
  const ha = headingOf(d, a) ?? 0, hb = headingOf(d, b) ?? 0;
  const mk = (from: Scene, to: Scene, heading: number): LinkHotspot => ({
    id: uid(), type: 'link', target: to.id, style: 'floor', arrival: null, pitch: -0.38,
    yaw: normAng((bearing(from.geo!, to.geo!) - heading) * DEG),
  });
  if (!linked(a, b.id)) a.hotspots.push(mk(a, b, ha));
  if (!linked(b, a.id)) b.hotspots.push(mk(b, a, hb));
}

export function removeBridge(d: TourData, aId: string, bId: string) {
  for (const [x, y] of [[aId, bId], [bId, aId]]) {
    const s = sceneById(d, x);
    if (s) s.hotspots = s.hotspots.filter(h => !(isLink(h) && h.target === y));
  }
}

/** Paires reliées (dans un sens ou l'autre) dont les deux photos sont placées. */
export function bridges(d: TourData) {
  const seen = new Set<string>();
  const out: [Scene, Scene][] = [];
  for (const s of d.scenes) {
    if (!s.geo) continue;
    for (const h of s.hotspots) {
      if (!isLink(h)) continue;
      const t = sceneById(d, h.target);
      if (!t?.geo || t === s) continue;
      const k = [s.id, t.id].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([s, t]);
    }
  }
  return out;
}

const angGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Relie automatiquement chaque photo à ses voisines les plus proches (≤ maxDist m, k max),
 * sans « sauter » une photo : une voisine est ignorée si une photo plus proche est déjà dans la même direction.
 * Renvoie le nombre de ponts créés.
 */
export function autoBridges(d: TourData, maxDist = 40, k = 2) {
  const placed = d.scenes.filter(s => s.geo);
  const before = bridges(d).length;
  for (const s of placed) {
    const taken: number[] = [];
    let n = 0;
    const near = placed
      .filter(t => t !== s)
      .map(t => ({ t, dist: distance(s.geo!, t.geo!), dir: bearing(s.geo!, t.geo!) }))
      .filter(x => x.dist <= maxDist)
      .sort((x, y) => x.dist - y.dist);
    for (const { t, dir } of near) {
      if (n >= k) break;
      if (taken.some(a => angGap(a, dir) < 30)) continue;
      taken.push(dir);
      addBridge(d, s.id, t.id);
      n++;
    }
  }
  return bridges(d).length - before;
}

/** Cap pour lequel la vue actuelle (yaw) regarde le nord. */
export const headingFromNorthView = (yaw: number) => norm360(-yaw / DEG);

export const fmtCoord = (v: number) => v.toFixed(6);
export { PI };
