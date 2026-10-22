import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cfg } from './config.js';

let db: DatabaseSync | null = null;

export function initDb() {
  if (db) return;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  db = new DatabaseSync(path.join(cfg.dataDir, 'urbanview.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tours (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      tour_id TEXT NOT NULL,
      name TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_tour ON media(tour_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sv_photos (
      tour_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      media TEXT NOT NULL,
      status TEXT,
      share_link TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tour_id, scene_id)
    );
  `);
}

export function closeDb() {
  db?.close();
  db = null;
}

const q = () => {
  if (!db) throw new Error('Base de données non initialisée');
  return db;
};

export interface TourRow { id: string; title: string; data: string; created_at: number; updated_at: number }
export interface MediaRow { id: string; tour_id: string; name: string; width: number; height: number; created_at: number }

export const tours = {
  list: () => q().prepare('SELECT id, title, data, updated_at FROM tours ORDER BY updated_at DESC').all() as unknown as TourRow[],
  get: (id: string) => q().prepare('SELECT * FROM tours WHERE id = ?').get(id) as unknown as TourRow | undefined,
  create(id: string, title: string, data: string) {
    const now = Date.now();
    q().prepare('INSERT INTO tours (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, title, data, now, now);
  },
  update(id: string, title: string, data: string) {
    const now = Date.now();
    q().prepare('UPDATE tours SET title = ?, data = ?, updated_at = ? WHERE id = ?').run(title, data, now, id);
    return now;
  },
  remove: (id: string) => { q().prepare('DELETE FROM tours WHERE id = ?').run(id); },
};

export const media = {
  add(m: Omit<MediaRow, 'created_at'>) {
    q().prepare('INSERT INTO media (id, tour_id, name, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, m.tour_id, m.name, m.width, m.height, Date.now());
  },
  byTour: (tourId: string) => q().prepare('SELECT * FROM media WHERE tour_id = ?').all(tourId) as unknown as MediaRow[],
  get: (id: string) => q().prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow | undefined,
  remove: (id: string) => { q().prepare('DELETE FROM media WHERE id = ?').run(id); },
  removeByTour: (tourId: string) => { q().prepare('DELETE FROM media WHERE tour_id = ?').run(tourId); },
};

export const settings = {
  get: (key: string) => (q().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value,
  set: (key: string, value: string) => { q().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); },
  del: (key: string) => { q().prepare('DELETE FROM settings WHERE key = ?').run(key); },
};

export interface SvRow { tour_id: string; scene_id: string; photo_id: string; media: string; status: string | null; share_link: string | null; updated_at: number }

export const svPhotos = {
  byTour: (tourId: string) => q().prepare('SELECT * FROM sv_photos WHERE tour_id = ?').all(tourId) as unknown as SvRow[],
  get: (tourId: string, sceneId: string) => q().prepare('SELECT * FROM sv_photos WHERE tour_id = ? AND scene_id = ?').get(tourId, sceneId) as unknown as SvRow | undefined,
  upsert(r: Omit<SvRow, 'updated_at'>) {
    q().prepare(`INSERT INTO sv_photos (tour_id, scene_id, photo_id, media, status, share_link, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tour_id, scene_id) DO UPDATE SET photo_id = excluded.photo_id, media = excluded.media, status = excluded.status, share_link = excluded.share_link, updated_at = excluded.updated_at`)
      .run(r.tour_id, r.scene_id, r.photo_id, r.media, r.status, r.share_link, Date.now());
  },
  remove: (tourId: string, sceneId: string) => { q().prepare('DELETE FROM sv_photos WHERE tour_id = ? AND scene_id = ?').run(tourId, sceneId); },
  removeByTour: (tourId: string) => { q().prepare('DELETE FROM sv_photos WHERE tour_id = ?').run(tourId); },
};
