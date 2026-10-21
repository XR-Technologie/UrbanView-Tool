import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'urbanview.db'));

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
`);

export interface TourRow { id: string; title: string; data: string; created_at: number; updated_at: number }
export interface MediaRow { id: string; tour_id: string; name: string; width: number; height: number; created_at: number }

export const tours = {
  list: () => db.prepare('SELECT id, title, data, updated_at FROM tours ORDER BY updated_at DESC').all() as unknown as TourRow[],
  get: (id: string) => db.prepare('SELECT * FROM tours WHERE id = ?').get(id) as unknown as TourRow | undefined,
  create(id: string, title: string, data: string) {
    const now = Date.now();
    db.prepare('INSERT INTO tours (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, title, data, now, now);
  },
  update(id: string, title: string, data: string) {
    const now = Date.now();
    db.prepare('UPDATE tours SET title = ?, data = ?, updated_at = ? WHERE id = ?').run(title, data, now, id);
    return now;
  },
  remove: (id: string) => { db.prepare('DELETE FROM tours WHERE id = ?').run(id); },
};

export const media = {
  add(m: Omit<MediaRow, 'created_at'>) {
    db.prepare('INSERT INTO media (id, tour_id, name, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, m.tour_id, m.name, m.width, m.height, Date.now());
  },
  byTour: (tourId: string) => db.prepare('SELECT * FROM media WHERE tour_id = ?').all(tourId) as unknown as MediaRow[],
  get: (id: string) => db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow | undefined,
  remove: (id: string) => { db.prepare('DELETE FROM media WHERE id = ?').run(id); },
  removeByTour: (tourId: string) => { db.prepare('DELETE FROM media WHERE tour_id = ?').run(tourId); },
};
