import type { FastifyInstance, FastifyRequest } from 'fastify';
import { google } from './google.js';
import { getJob, publish, refresh, unpublish } from './streetview.js';
import { svPhotos, tours } from './db.js';

type IdParams = { Params: { id: string } };

const originOf = (req: FastifyRequest) =>
  process.env.UV_PUBLIC_URL || `http://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

const page = (title: string, text: string, ok: boolean) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#050b15;color:#e9f0f9;font:15px system-ui,sans-serif}
div{text-align:center;max-width:440px;padding:32px}b{display:block;font-size:22px;margin-bottom:10px;color:${ok ? '#36d69a' : '#ff5b6b'}}</style></head>
<body><div><b>${title}</b>${text}</div>${ok ? '<script>setTimeout(()=>window.close(),1800)</script>' : ''}</body></html>`;

const svState = (id: string) => ({
  job: getJob(id),
  photos: svPhotos.byTour(id).map(r => ({ sceneId: r.scene_id, photoId: r.photo_id, media: r.media, status: r.status, shareLink: r.share_link, updatedAt: r.updated_at })),
});

export async function streetviewRoutes(app: FastifyInstance) {
  /* ---------- compte Google ---------- */
  app.get('/api/google/status', async () => google.status());

  app.put<{ Body: { clientId?: string; clientSecret?: string } }>('/api/google/config', async (req, reply) => {
    const { clientId = '', clientSecret = '' } = req.body ?? {};
    if (!clientId.trim()) return reply.code(400).send({ error: 'Client ID requis' });
    google.setConfig(clientId, clientSecret);
    return google.status();
  });

  app.get<{ Querystring: { returnTo?: string } }>('/api/google/auth', async (req, reply) => {
    try {
      return reply.redirect(google.authUrl(`${originOf(req)}/api/google/callback`, req.query.returnTo || '/'));
    } catch (e) {
      return reply.type('text/html').send(page('Connexion impossible', (e as Error).message, false));
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/google/callback', async (req, reply) => {
    const { code, state, error } = req.query;
    reply.type('text/html');
    if (error || !code || !state) return page('Connexion annulée', error ? `Google : ${error}` : 'Aucun code reçu.', false);
    try {
      await google.callback(code, state);
      return page('Compte Google connecté', 'Vous pouvez fermer cet onglet et revenir dans Urbanview 360 XR.', true);
    } catch (e) {
      return page('Connexion impossible', (e as Error).message, false);
    }
  });

  app.post('/api/google/logout', async () => { google.logout(); return google.status(); });

  /* ---------- publication ---------- */
  app.get<IdParams>('/api/tours/:id/streetview', async req => svState(req.params.id));

  app.post<IdParams & { Body: { mode?: 'all' | 'connections'; headings?: Record<string, number> } }>('/api/tours/:id/streetview', async (req, reply) => {
    if (!tours.get(req.params.id)) return reply.code(404).send({ error: 'Visite introuvable' });
    try {
      await publish(req.params.id, req.body?.headings ?? {}, req.body?.mode === 'connections' ? 'connections' : 'all');
      return svState(req.params.id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<IdParams>('/api/tours/:id/streetview/refresh', async (req, reply) => {
    try { await refresh(req.params.id); return svState(req.params.id); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.delete<IdParams>('/api/tours/:id/streetview', async (req, reply) => {
    try { await unpublish(req.params.id); return svState(req.params.id); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
}
