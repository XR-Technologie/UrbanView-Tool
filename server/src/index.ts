import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const { app, port, hasWeb } = await startServer({
  port: Number(process.env.PORT || 3360),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.UV_DATA_DIR || path.join(root, 'data'),
  webDist: path.join(root, 'web', 'dist'),
  playerDist: path.join(root, 'web', 'dist-player'),
});

app.log.info(`Urbanview 360 XR — http://localhost:${port}${hasWeb ? '' : ' (API seule, interface sur Vite)'}`);
