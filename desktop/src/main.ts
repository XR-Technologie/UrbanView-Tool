import path from 'node:path';
import { BrowserWindow, Menu, app, dialog, shell } from 'electron';
import { startServer } from '../../server/src/app.js';

type Server = Awaited<ReturnType<typeof startServer>>;

let server: Server | null = null;
let mainWin: BrowserWindow | null = null;
let origin = '';

const icon = path.join(__dirname, '../build/icon.png');
const webDist = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../../web/dist');
const playerDist = app.isPackaged ? path.join(process.resourcesPath, 'player') : path.join(__dirname, '../../web/dist-player');

function makeWindow(url: string) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#050b15',
    title: 'Urbanview 360 XR',
    icon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());

  // Aperçu (/tour/…) → nouvelle fenêtre de l'app ; liens externes → navigateur par défaut
  // Connexion Google → navigateur du système (Google refuse les fenêtres intégrées)
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith(origin) && !u.includes('/api/google/auth')) makeWindow(u);
    else shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(origin)) { e.preventDefault(); shell.openExternal(u); }
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });

  win.loadURL(url);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      server = await startServer({
        port: 0,
        host: '127.0.0.1',
        logger: false,
        dataDir: path.join(app.getPath('userData'), 'data'),
        webDist,
        playerDist,
      });
    } catch (e) {
      dialog.showErrorBox('Urbanview 360 XR', `Impossible de démarrer le moteur :\n${(e as Error).message}`);
      app.quit();
      return;
    }
    origin = `http://127.0.0.1:${server.port}`;
    mainWin = makeWindow(`${origin}/`);
    mainWin.on('closed', () => { mainWin = null; });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { server?.close().catch(() => {}); });
}
