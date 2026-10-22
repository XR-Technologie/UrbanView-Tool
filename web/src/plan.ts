/**
 * Relevé de points (fichier .uvplan) : produit sur place par l'appli téléphone (AR),
 * importé dans le studio puis calé sur la carte à partir d'un seul point.
 *
 * Repère du plan, en mètres : x vers la droite, y vers l'avant (début du relevé), z vers le haut.
 * Les angles sont en degrés, sens horaire depuis +y (comme un cap).
 */
import { bearing, norm360, offsetMeters } from './geo';
import type { Scene, TourData } from './types';

export interface PlanPoint {
  id: string;
  /** Numéro affiché (ordre du relevé, à partir de 1). */
  n: number;
  x: number;
  y: number;
  z: number;
  /** Direction de l'objectif de la caméra ; null = non relevée. */
  yaw: number | null;
  /** Heure du relevé (ms). */
  t: number;
}

export interface PlanFile {
  format: 'urbanview-plan';
  version: 1;
  name: string;
  createdAt: number;
  /** Rotation plan → nord géographique estimée par la boussole du téléphone (indicative). */
  northHint: number | null;
  points: PlanPoint[];
}

/** Calage sur la carte : un point du plan posé en lat/lng + rotation (cap de l'axe +y du plan). */
export interface PlanAnchor { pointId: string; lat: number; lng: number; rotation: number }

/** Plan rattaché à une visite. */
export interface TourPlan extends PlanFile {
  /** Écart entre l'objectif de la caméra et le centre du panorama (propre au modèle de caméra). */
  lensOffset: number;
  anchor: PlanAnchor | null;
}

export const PLAN_EXT = '.uvplan';

/* ------------------------------------------------------------------ */
/* Géométrie 2D                                                        */
/* ------------------------------------------------------------------ */

const D = Math.PI / 180;

/** Angle (sens horaire depuis +y) d'un vecteur du plan. */
export const angleOf = (x: number, y: number) => norm360(Math.atan2(x, y) / D);

/** Rotation horaire d'un vecteur du plan. */
export function rotate(x: number, y: number, deg: number): [number, number] {
  const c = Math.cos(deg * D), s = Math.sin(deg * D);
  return [x * c + y * s, -x * s + y * c];
}

/** Moyenne circulaire d'angles en degrés (null si vide). */
export function meanAngle(list: number[]): number | null {
  if (!list.length) return null;
  let sx = 0, sy = 0;
  for (const a of list) { sx += Math.cos(a * D); sy += Math.sin(a * D); }
  return norm360(Math.atan2(sy, sx) / D);
}

/* ------------------------------------------------------------------ */
/* Fichier                                                             */
/* ------------------------------------------------------------------ */

export function serializePlan(p: PlanFile) {
  const out: PlanFile = {
    format: 'urbanview-plan', version: 1, name: p.name, createdAt: p.createdAt, northHint: p.northHint,
    points: p.points.map(({ id, n, x, y, z, yaw, t }) => ({ id, n, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), yaw: yaw == null ? null : +yaw.toFixed(2), t })),
  };
  return JSON.stringify(out, null, 1);
}

/** Lit et valide un fichier .uvplan. Lève une erreur lisible sinon. */
export function parsePlan(text: string): PlanFile {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text); } catch { throw new Error('Fichier illisible'); }
  if (o?.format !== 'urbanview-plan') throw new Error('Ce fichier n’est pas un relevé Urbanview');
  if (o.version !== 1) throw new Error('Version de relevé non prise en charge');
  if (!Array.isArray(o.points) || !o.points.length) throw new Error('Le relevé ne contient aucun point');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const points = (o.points as Record<string, unknown>[]).map((p, i): PlanPoint => {
    const x = num(p.x), y = num(p.y);
    if (x == null || y == null) throw new Error(`Point ${i + 1} invalide`);
    return {
      id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}`,
      n: num(p.n) ?? i + 1,
      x, y, z: num(p.z) ?? 0,
      yaw: num(p.yaw),
      t: num(p.t) ?? 0,
    };
  });
  return {
    format: 'urbanview-plan', version: 1,
    name: typeof o.name === 'string' ? o.name : 'Relevé',
    createdAt: num(o.createdAt) ?? Date.now(),
    northHint: num(o.northHint),
    points,
  };
}

/* ------------------------------------------------------------------ */
/* Studio : liaison photos ↔ points                                    */
/* ------------------------------------------------------------------ */

/**
 * Associe les photos aux points par ordre chronologique.
 * Les horloges de la caméra et du téléphone diffèrent (fuseau, dérive) : on cherche le décalage
 * qui fait correspondre le plus de paires (± 90 s), puis on apparie dans l'ordre.
 * Sans dates exploitables, on apparie simplement dans l'ordre de la liste.
 */
export function matchByTime(points: PlanPoint[], scenes: Scene[]): Map<string, string> {
  const pts = [...points].sort((a, b) => a.t - b.t || a.n - b.n);
  const dated = scenes.filter(s => s.captureTime).sort((a, b) => a.captureTime! - b.captureTime!);
  const out = new Map<string, string>();
  const byOrder = (list: Scene[]) => { list.forEach((s, i) => { if (pts[i]) out.set(s.id, pts[i].id); }); return out; };

  if (dated.length < 2 || pts.every(p => !p.t)) return byOrder(dated.length === scenes.length ? dated : scenes);
  if (dated.length === pts.length) return byOrder(dated);

  const TOL = 90_000;
  const ts = pts.map(p => p.t);
  const near = (t: number) => { // un point à ± TOL de t ? (recherche dichotomique)
    let lo = 0, hi = ts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t - TOL) lo = m + 1; else hi = m; }
    return lo < ts.length && ts[lo] <= t + TOL;
  };
  let best = 0, bestHits = -1;
  for (const s of dated) {
    for (const p of pts) {
      const off = s.captureTime! - p.t;
      let hits = 0;
      for (const s2 of dated) if (near(s2.captureTime! - off)) hits++;
      if (hits > bestHits) { bestHits = hits; best = off; }
    }
  }
  // appariement monotone : chaque photo prend le point non utilisé le plus proche, sans revenir en arrière
  let from = 0;
  for (const s of dated) {
    const t = s.captureTime! - best;
    let k = -1, gap = TOL;
    for (let i = from; i < pts.length; i++) {
      const g = Math.abs(pts[i].t - t);
      if (g <= gap) { gap = g; k = i; }
    }
    if (k >= 0) { out.set(s.id, pts[k].id); from = k + 1; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Studio : calage géographique                                        */
/* ------------------------------------------------------------------ */

export interface PlanGeo { lat: number; lng: number; heading: number | null }

/** Position et cap géographiques de chaque point, d'après l'ancrage. */
export function planToGeo(plan: TourPlan): Map<string, PlanGeo> {
  const out = new Map<string, PlanGeo>();
  const a = plan.anchor;
  const ref = a && plan.points.find(p => p.id === a.pointId);
  if (!a || !ref) return out;
  for (const p of plan.points) {
    const [east, north] = rotate(p.x - ref.x, p.y - ref.y, a.rotation);
    out.set(p.id, {
      ...offsetMeters(a, east, north),
      heading: p.yaw == null ? null : norm360(p.yaw + a.rotation + plan.lensOffset),
    });
  }
  return out;
}

/** Rotation qui amène le point `pointId` sur la position `to`, l'ancre restant fixe. */
export function rotationToward(plan: TourPlan, pointId: string, to: { lat: number; lng: number }): number | null {
  const a = plan.anchor;
  const ref = a && plan.points.find(p => p.id === a.pointId);
  const p = plan.points.find(x => x.id === pointId);
  if (!a || !ref || !p || p === ref) return null;
  if (Math.hypot(p.x - ref.x, p.y - ref.y) < 0.2) return null;
  return norm360(bearing(a, to) - angleOf(p.x - ref.x, p.y - ref.y));
}

/** Recopie les positions du plan calé sur les photos reliées. Modifie `d` en place. */
export function applyPlan(d: TourData) {
  if (!d.plan?.anchor) return;
  const geo = planToGeo(d.plan);
  for (const s of d.scenes) {
    const g = s.planPoint ? geo.get(s.planPoint) : undefined;
    if (!g) continue;
    s.geo = { lat: g.lat, lng: g.lng, heading: g.heading ?? s.geo?.heading ?? null };
  }
}

export const sceneOfPoint = (d: TourData, pointId: string) => d.scenes.find(s => s.planPoint === pointId) ?? null;
