import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { svPhotos, tours } from './db.js';
import { google } from './google.js';
import { mediaDir } from './media.js';

/* Publication Google Street View : envoi des photos (avec métadonnées Photo Sphere),
   position + cap, puis « ponts » (connexions) entre photos reliées. */

interface Geo { lat: number; lng: number; heading?: number | null; alt?: number }
interface SceneSV { id: string; name: string; media: string; geo?: Geo; captureTime?: number; hotspots: { type: string; target?: string | null }[] }

export interface Job { running: boolean; done: number; total: number; step: string; error?: string; log: string[]; finishedAt?: number }

const jobs = new Map<string, Job>();
export const getJob = (tourId: string) => jobs.get(tourId) ?? null;

/** Ajoute le segment XMP GPano requis par Street View (photo sphère équirectangulaire). */
export function injectGPano(jpeg: Buffer, w: number, h: number, heading: number): Buffer {
  const g = (k: string, v: string | number) => `<GPano:${k}>${v}</GPano:${k}>`;
  const xmp = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">'
    + g('ProjectionType', 'equirectangular') + g('UsePanoramaViewer', 'True')
    + g('FullPanoWidthPixels', w) + g('FullPanoHeightPixels', h)
    + g('CroppedAreaImageWidthPixels', w) + g('CroppedAreaImageHeightPixels', h)
    + g('CroppedAreaLeftPixels', 0) + g('CroppedAreaTopPixels', 0)
    + g('PoseHeadingDegrees', heading.toFixed(1))
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const payload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmp, 'utf8')]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  let pos = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) pos = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, pos), head, payload, jpeg.subarray(pos)]);
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const pose = (s: SceneSV, heading: number) => ({
  latLngPair: { latitude: s.geo!.lat, longitude: s.geo!.lng },
  heading: norm360(heading),
  ...(s.geo!.alt != null ? { altitude: s.geo!.alt } : {}),
});

const loadTour = (tourId: string) => {
  const row = tours.get(tourId);
  if (!row) throw new Error('Visite introuvable');
  return JSON.parse(row.data) as { scenes: SceneSV[] };
};

/** Met à jour le statut Google (publication, lien Maps) des photos envoyées. */
export async function refresh(tourId: string) {
  for (const r of svPhotos.byTour(tourId)) {
    try {
      const p = await google.api<{ mapsPublishStatus?: string; shareLink?: string }>('GET', `photo/${r.photo_id}?view=BASIC`);
      svPhotos.upsert({ ...r, status: p.mapsPublishStatus ?? r.status, share_link: p.shareLink ?? r.share_link });
    } catch (e) {
      if (/not found|404/i.test((e as Error).message)) svPhotos.remove(tourId, r.scene_id);
    }
  }
  return svPhotos.byTour(tourId);
}

export async function unpublish(tourId: string) {
  const rows = svPhotos.byTour(tourId);
  for (let i = 0; i < rows.length; i += 20) {
    await google.api('POST', 'photos:batchDelete', { photoIds: rows.slice(i, i + 20).map(r => r.photo_id) }).catch(() => {});
  }
  svPhotos.removeByTour(tourId);
}

/**
 * Lance la publication en arrière-plan.
 * mode « all » : envoie les photos nouvelles ou modifiées puis met à jour les ponts ;
 * mode « connections » : met seulement à jour positions, caps et ponts.
 */
export async function publish(tourId: string, headings: Record<string, number>, mode: 'all' | 'connections') {
  if (jobs.get(tourId)?.running) throw new Error('Publication déjà en cours');
  const data = loadTour(tourId);
  const scenes = data.scenes.filter(s => s.geo && Number.isFinite(s.geo.lat) && Number.isFinite(s.geo.lng));
  if (!scenes.length) throw new Error('Aucune photo n’est placée sur la carte');
  await google.token();

  const job: Job = { running: true, done: 0, total: (mode === 'all' ? scenes.length : 0) + 2, step: 'Préparation', log: [] };
  jobs.set(tourId, job);
  const heading = (s: SceneSV) => headings[s.id] ?? s.geo?.heading ?? 0;

  (async () => {
    try {
      if (mode === 'all') {
        for (const s of scenes) {
          job.step = `Envoi · ${s.name}`;
          const ex = svPhotos.get(tourId, s.id);
          if (ex && ex.media === s.media) { job.done++; continue; }
          if (ex) {
            await google.api('DELETE', `photo/${ex.photo_id}`).catch(() => {});
            svPhotos.remove(tourId, s.id);
          }
          const buf = await fs.readFile(path.join(mediaDir(s.media), 'full.jpg'));
          const meta = await sharp(buf).metadata();
          const body = injectGPano(buf, meta.width ?? 0, meta.height ?? 0, norm360(heading(s)));
          const { uploadUrl } = await google.api<{ uploadUrl: string }>('POST', 'photo:startUpload', {});
          const up = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${await google.token()}`,
              'Content-Type': 'image/jpeg',
              'X-Goog-Upload-Protocol': 'raw',
              'X-Goog-Upload-Content-Length': String(body.length),
            },
            body: new Uint8Array(body),
          });
          if (!up.ok) throw new Error(`Envoi de « ${s.name} » refusé (${up.status})`);
          const photo = await google.api<{ photoId: { id: string }; shareLink?: string }>('POST', 'photo', {
            uploadReference: { uploadUrl },
            pose: pose(s, heading(s)),
            captureTime: new Date(s.captureTime ?? Date.now()).toISOString(),
          });
          svPhotos.upsert({ tour_id: tourId, scene_id: s.id, photo_id: photo.photoId.id, media: s.media, status: 'PENDING', share_link: photo.shareLink ?? null });
          job.log.push(`Envoyée : ${s.name}`);
          job.done++;
        }
      }

      // Ponts : connexions symétriques entre photos publiées reliées par un lien
      job.step = 'Ponts entre les photos';
      const pub = new Map(svPhotos.byTour(tourId).map(r => [r.scene_id, r]));
      const adj = new Map<string, Set<string>>();
      const add = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a)!.add(b); };
      for (const s of data.scenes) {
        for (const h of s.hotspots) {
          if (h.type !== 'link' || !h.target || h.target === s.id || !pub.has(s.id) || !pub.has(h.target)) continue;
          add(s.id, h.target);
          add(h.target, s.id);
        }
      }
      const reqs = scenes.filter(s => pub.has(s.id)).map(s => ({
        photo: {
          photoId: { id: pub.get(s.id)!.photo_id },
          pose: pose(s, heading(s)),
          connections: [...(adj.get(s.id) ?? [])].map(t => ({ target: { id: pub.get(t)!.photo_id } })),
        },
        updateMask: 'connections,pose.heading,pose.lat_lng_pair',
      }));
      for (let i = 0; i < reqs.length; i += 20) {
        const r = await google.api<{ results?: { status?: { code?: number; message?: string } }[] }>('POST', 'photos:batchUpdate', { updatePhotoRequests: reqs.slice(i, i + 20) });
        r.results?.forEach(x => { if (x.status?.code) job.log.push(`Attention : ${x.status.message}`); });
      }
      const bridges = [...adj.values()].reduce((a, s) => a + s.size, 0) / 2;
      job.log.push(`${bridges} pont${bridges > 1 ? 's' : ''} mis à jour`);
      job.done++;

      job.step = 'Statuts Google';
      await refresh(tourId);
      job.done++;
      job.step = 'Terminé';
    } catch (e) {
      job.error = (e as Error).message;
      job.step = 'Erreur';
    }
    job.running = false;
    job.finishedAt = Date.now();
  })();

  return job;
}
