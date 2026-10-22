import { norm360 } from '../geo';
import { angleOf, meanAngle, rotate, serializePlan, type PlanFile, type PlanPoint } from '../plan';
import type { V3 } from './xr';

/** Relevé en cours sur le téléphone. */
export interface Survey {
  id: string;
  name: string;
  createdAt: number;
  points: PlanPoint[];
  /** Échantillons « cap boussole − angle dans le plan » pour estimer le nord. */
  north: number[];
}

/**
 * Passage du repère d'une session AR (x droite, y haut, −z devant) au repère du plan.
 * Chaque session AR a son propre repère : après une interruption, on le recale sur 2 points déjà relevés.
 */
export interface Xf { rot: number; tx: number; ty: number; tz: number }

export function toPlan(xf: Xf, v: V3): [number, number, number] {
  const [x, y] = rotate(v[0], -v[2], xf.rot);
  return [x + xf.tx, y + xf.ty, v[1] + xf.tz];
}

export function toLocal(xf: Xf, p: { x: number; y: number; z: number }): V3 {
  const [x, y] = rotate(p.x - xf.tx, p.y - xf.ty, -xf.rot);
  return [x, p.z - xf.tz, -y];
}

/** Angle dans le plan d'une direction de la session AR (null si quasi verticale). */
export function dirToPlan(xf: Xf, v: V3): number | null {
  if (Math.hypot(v[0], v[2]) < 0.3) return null;
  return norm360(angleOf(v[0], -v[2]) + xf.rot);
}

/** Premier point : il devient l'origine du plan. */
export const xfFromFirst = (v: V3): Xf => ({ rot: 0, tx: -v[0], ty: v[2], tz: -v[1] });

/**
 * Recalage d'une nouvelle session : `local[i]` sont les positions re-visées des points `plan[i]`.
 * Renvoie la transformation et l'écart de distance (m) entre les deux mesures, pour contrôle.
 */
export function xfFromPairs(plan: PlanPoint[], local: V3[]): { xf: Xf; error: number } {
  const r = local.map(v => [v[0], -v[2]] as const);
  const [p1, p2] = plan, [r1, r2] = r;
  const rot = norm360(angleOf(p2.x - p1.x, p2.y - p1.y) - angleOf(r2[0] - r1[0], r2[1] - r1[1]));
  let tx = 0, ty = 0, tz = 0;
  plan.forEach((p, i) => {
    const [x, y] = rotate(r[i][0], r[i][1], rot);
    tx += (p.x - x) / plan.length;
    ty += (p.y - y) / plan.length;
    tz += (p.z - local[i][1]) / plan.length;
  });
  const error = Math.abs(Math.hypot(p2.x - p1.x, p2.y - p1.y) - Math.hypot(r2[0] - r1[0], r2[1] - r1[1]));
  return { xf: { rot, tx, ty, tz }, error };
}

export const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------------------------------------------ */
/* Stockage local et export                                             */
/* ------------------------------------------------------------------ */

const KEY = 'uv-capture-surveys';

export function loadSurveys(): Survey[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveSurveys(list: Survey[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* stockage indisponible */ }
}

export function toPlanFile(s: Survey): PlanFile {
  return { format: 'urbanview-plan', version: 1, name: s.name, createdAt: s.createdAt, northHint: meanAngle(s.north), points: s.points };
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'releve';

/** Partage le fichier (Drive, e-mail, messagerie…) ; sinon le télécharge. */
export async function exportSurvey(s: Survey, mode: 'share' | 'download') {
  const text = serializePlan(toPlanFile(s));
  const base = slug(s.name);
  if (mode === 'share' && navigator.canShare) {
    for (const [name, type] of [[`${base}.uvplan`, 'application/json'], [`${base}.uvplan.json`, 'application/json'], [`${base}.uvplan.txt`, 'text/plain']]) {
      const file = new File([text], name, { type });
      if (!navigator.canShare({ files: [file] })) continue;
      try { await navigator.share({ files: [file], title: s.name }); } catch { /* partage annulé */ }
      return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${base}.uvplan`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
