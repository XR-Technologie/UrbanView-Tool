import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { cfg, configure, type ServerPaths } from './config.js';
import { closeDb, initDb } from './db.js';
import { routes } from './routes.js';
import { streetviewRoutes } from './streetviewRoutes.js';

export interface StartOptions extends Partial<ServerPaths> {
  port?: number;
  host?: string;
  logger?: boolean;
}

/** Démarre l'API + l'interface. Utilisé par la ligne de commande et par l'application de bureau. */
export async function startServer(o: StartOptions = {}) {
  configure({ dataDir: o.dataDir, webDist: o.webDist, playerDist: o.playerDist });
  fs.mkdirSync(cfg.mediaDir, { recursive: true });
  initDb();

  const app = Fastify({
    logger: o.logger === false ? false : { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(multipart, { limits: { fileSize: 400 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: cfg.mediaDir, prefix: '/media/', decorateReply: false, maxAge: '1h' });

  const hasWeb = fs.existsSync(path.join(cfg.webDist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: cfg.webDist, prefix: '/' });

  await app.register(routes);
  await app.register(streetviewRoutes);

  app.setNotFoundHandler((req, reply) => {
    if (!hasWeb || req.url.startsWith('/api') || req.url.startsWith('/media')) {
      return reply.code(404).send({ error: 'Introuvable' });
    }
    return reply.sendFile('index.html');
  });

  await app.listen({ port: o.port ?? 3360, host: o.host ?? '0.0.0.0' });
  const port = (app.server.address() as AddressInfo).port;

  return {
    app,
    port,
    hasWeb,
    close: async () => { await app.close(); closeDb(); },
  };
}
