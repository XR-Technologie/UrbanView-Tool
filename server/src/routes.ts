import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { PLAYER_DIST } from './config.js';
import { media, tours } from './db.js';
import { isSafeId, makeThumb, mediaDir, processPanorama, removeMedia } from './media.js';

interface SceneLite { id: string; media: string; thumbV?: number }
interface DataLite { startScene: string | null; scenes: SceneLite[] }

const parseData = (raw: string): DataLite => {
  try {
    const d = JSON.parse(raw);
    return { startScene: d.startScene ?? null, scenes: Array.isArray(d.scenes) ? d.scenes : [] };
  } catch {
    return { startScene: null, scenes: [] };
  }
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'visite';

type IdParams = { Params: { id: string } };

export async function routes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/tours', async () => tours.list().map(r => {
    const d = parseData(r.data);
    const cover = d.scenes.find(s => s.id === d.startScene) ?? d.scenes[0];
    return {
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      sceneCount: d.scenes.length,
      cover: cover ? `/media/${cover.media}/thumb.jpg?v=${cover.thumbV ?? 0}` : null,
    };
  }));

  app.post<{ Body: { title?: string } }>('/api/tours', async req => {
    const id = nanoid(10);
    const title = (req.body?.title || 'Nouvelle visite').slice(0, 120);
    const data = { settings: {}, startScene: null, scenes: [] };
    tours.create(id, title, JSON.stringify(data));
    return { id, title, data };
  });

  app.get<IdParams>('/api/tours/:id', async (req, reply) => {
    const row = tours.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'Visite introuvable' });
    return { id: row.id, title: row.title, data: JSON.parse(row.data), updatedAt: row.updated_at };
  });

  app.put<IdParams & { Body: { title?: string; data?: { scenes?: unknown } } }>('/api/tours/:id', async (req, reply) => {
    const row = tours.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'Visite introuvable' });
    const { title, data } = req.body ?? {};
    if (!data || !Array.isArray(data.scenes)) return reply.code(400).send({ error: 'Données invalides' });
    const updatedAt = tours.update(row.id, (title || row.title).slice(0, 120), JSON.stringify(data));
    return { ok: true, updatedAt };
  });

  app.delete<IdParams>('/api/tours/:id', async req => {
    for (const m of media.byTour(req.params.id)) await removeMedia(m.id);
    media.removeByTour(req.params.id);
    tours.remove(req.params.id);
    return { ok: true };
  });

  app.post<IdParams>('/api/tours/:id/media', async (req, reply) => {
    if (!tours.get(req.params.id)) return reply.code(404).send({ error: 'Visite introuvable' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Aucun fichier' });
    if (!file.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'Format non supporté' });
    const buf = await file.toBuffer();
    const id = nanoid(12);
    try {
      const info = await processPanorama(id, buf);
      media.add({ id, tour_id: req.params.id, name: file.filename, width: info.width, height: info.height });
      return { id, name: file.filename, ...info };
    } catch (e) {
      req.log.error(e);
      await removeMedia(id);
      return reply.code(422).send({ error: 'Image illisible' });
    }
  });

  app.post<IdParams & { Body: { yaw?: number; pitch?: number } }>('/api/media/:id/thumb', async (req, reply) => {
    const { id } = req.params;
    if (!isSafeId(id) || !media.get(id)) return reply.code(404).send({ error: 'Média introuvable' });
    await makeThumb(id, Number(req.body?.yaw) || 0, Number(req.body?.pitch) || 0);
    return { ok: true };
  });

  app.delete<IdParams>('/api/media/:id', async req => {
    await removeMedia(req.params.id);
    media.remove(req.params.id);
    return { ok: true };
  });

  /** Export : lecteur autonome + photos, prêt à héberger. */
  app.get<IdParams & { Querystring: { check?: string } }>('/api/tours/:id/export', async (req, reply) => {
    const row = tours.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'Visite introuvable' });
    const playerHtml = path.join(PLAYER_DIST, 'player.html');
    if (!fs.existsSync(playerHtml)) {
      const error = 'Lecteur non compilé : lancez « npm run build » puis réessayez.';
      return req.query.check ? { ok: false, error } : reply.code(400).send({ error });
    }
    if (req.query.check) return { ok: true };

    const data = JSON.parse(row.data);
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('warning', e => req.log.warn(e));
    archive.glob('**/*', { cwd: PLAYER_DIST, ignore: ['player.html'] });
    archive.file(playerHtml, { name: 'index.html' });
    archive.append(`window.__TOUR__=${JSON.stringify({ id: row.id, title: row.title, data }).replace(/</g, '\\u003c')};`, { name: 'tour.js' });
    for (const s of parseData(row.data).scenes) {
      if (!isSafeId(s.media)) continue;
      for (const v of ['full', 'mid', 'low', 'thumb']) {
        const f = path.join(mediaDir(s.media), `${v}.jpg`);
        if (fs.existsSync(f)) archive.file(f, { name: `media/${s.media}/${v}.jpg` });
      }
    }
    archive.finalize();
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${slug(row.title)}.zip"`);
    return reply.send(archive);
  });
}
