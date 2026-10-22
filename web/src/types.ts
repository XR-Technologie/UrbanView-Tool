import { PI, normAng } from './engine/math';
import type { TourPlan } from './plan';

export interface View { yaw: number; pitch: number; fov: number }

export interface LinkHotspot {
  id: string;
  type: 'link';
  yaw: number;
  pitch: number;
  target: string | null;
  style: 'floor' | 'pin';
  /** Vue d'arrivée propre à ce lien (null = automatique). */
  arrival: View | null;
}
export interface InfoHotspot { id: string; type: 'info'; yaw: number; pitch: number; title: string; text: string; url: string }
export type Hotspot = LinkHotspot | InfoHotspot;

/** Position géographique. heading = cap (degrés, 0 = nord) du centre du panorama ; null = automatique. */
export interface Geo { lat: number; lng: number; heading: number | null; alt?: number }

export interface Scene {
  /** Position sur la carte (Street View). */
  geo?: Geo;
  /** Date de prise de vue (ms). */
  captureTime?: number;
  /** Point du relevé (plan) correspondant à cette photo. */
  planPoint?: string;
  id: string;
  name: string;
  media: string;
  /** Photo d'origine conservée après retouche (pour revenir en arrière). */
  originalMedia?: string;
  width: number;
  height: number;
  thumbV: number;
  view: View;
  hotspots: Hotspot[];
}

export interface TourSettings {
  accent: string;
  logo: string;
  ctaLabel: string;
  ctaUrl: string;
  transition: 'zoom' | 'fade';
  duration: number;
  intro: boolean;
  autorotate: boolean;
}

export interface TourData {
  settings: TourSettings;
  startScene: string | null;
  scenes: Scene[];
  /** Relevé des emplacements fait sur place (appli téléphone). */
  plan?: TourPlan;
}
export interface TourDoc { id: string; title: string; data: TourData; updatedAt?: number }
export interface TourSummary { id: string; title: string; sceneCount: number; cover: string | null; updatedAt: number }
export interface MediaInfo { id: string; name: string; width: number; height: number; geo?: Geo; captureTime?: number }

export interface GoogleStatus { clientId: string; configured: boolean; connected: boolean }
export interface SvJob { running: boolean; done: number; total: number; step: string; error?: string; log: string[]; finishedAt?: number }
export interface SvPhoto { sceneId: string; photoId: string; media: string; status: string | null; shareLink: string | null; updatedAt: number }
export interface SvState { job: SvJob | null; photos: SvPhoto[] }

export const DEFAULT_VIEW: View = { yaw: 0, pitch: 0, fov: 75 };

export const defaultSettings = (): TourSettings => ({
  accent: '#2A8BD0',
  logo: '',
  ctaLabel: '',
  ctaUrl: '',
  transition: 'zoom',
  duration: 1.3,
  intro: true,
  autorotate: true,
});

export function normalizeDoc(doc: TourDoc): TourDoc {
  const d = (doc.data ?? {}) as Partial<TourData>;
  return {
    ...doc,
    data: {
      settings: { ...defaultSettings(), ...(d.settings ?? {}) },
      startScene: d.startScene ?? null,
      scenes: (d.scenes ?? []).map(s => ({ ...s, thumbV: s.thumbV ?? 0, view: { ...DEFAULT_VIEW, ...s.view }, hotspots: s.hotspots ?? [] })),
      ...(d.plan ? { plan: { ...d.plan, lensOffset: d.plan.lensOffset ?? 0, anchor: d.plan.anchor ?? null } } : {}),
    },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const mediaUrl = (base: string, id: string, v: string, ver?: number) => `${base}/${id}/${v}.jpg${ver ? `?v=${ver}` : ''}`;
export const sceneById = (d: TourData, id: string | null | undefined) => d.scenes.find(s => s.id === id) ?? null;
export const startSceneOf = (d: TourData) => sceneById(d, d.startScene) ?? d.scenes[0] ?? null;
export const isLink = (h: Hotspot): h is LinkHotspot => h.type === 'link';

/**
 * Vue d'arrivée quand on suit `h` depuis la scène `fromId` :
 * 1. vue réglée sur le lien ;
 * 2. sinon, alignée automatiquement : dos au lien retour (on regarde dans le sens de la marche) ;
 * 3. sinon, vue par défaut de la scène cible.
 */
export function arrivalFor(d: TourData, fromId: string, h: LinkHotspot): View {
  const target = sceneById(d, h.target);
  if (!target) return DEFAULT_VIEW;
  if (h.arrival) return h.arrival;
  const back = target.hotspots.find(x => isLink(x) && x.target === fromId);
  if (back) return { yaw: normAng(back.yaw + PI), pitch: 0, fov: target.view.fov };
  return target.view;
}
