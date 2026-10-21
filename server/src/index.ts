import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { HOST, MEDIA_DIR, PORT, WEB_DIST } from './config.js';
import { routes } from './routes.js';

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(multipart, { limits: { fileSize: 400 * 1024 * 1024, files: 1 } });
await app.register(fastifyStatic, { root: MEDIA_DIR, prefix: '/media/', decorateReply: false, maxAge: '1h' });

const hasWeb = fs.existsSync(path.join(WEB_DIST, 'index.html'));
if (hasWeb) await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });

await app.register(routes);

app.setNotFoundHandler((req, reply) => {
  if (!hasWeb || req.url.startsWith('/api') || req.url.startsWith('/media')) {
    return reply.code(404).send({ error: 'Introuvable' });
  }
  return reply.sendFile('index.html');
});

await app.listen({ port: PORT, host: HOST });
app.log.info(`Urbanview 360 XR — http://localhost:${PORT}${hasWeb ? '' : ' (API seule, interface sur Vite)'}`);
