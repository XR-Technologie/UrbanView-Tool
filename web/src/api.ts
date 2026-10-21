import type { MediaInfo, TourData, TourDoc, TourSummary, View } from './types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  tours: () => req<TourSummary[]>('GET', '/api/tours'),
  createTour: (title: string) => req<TourDoc>('POST', '/api/tours', { title }),
  tour: (id: string) => req<TourDoc>('GET', `/api/tours/${id}`),
  saveTour: (id: string, title: string, data: TourData) => req<{ ok: boolean }>('PUT', `/api/tours/${id}`, { title, data }),
  deleteTour: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tours/${id}`),
  thumb: (media: string, v: View) => req<{ ok: boolean }>('POST', `/api/media/${media}/thumb`, { yaw: v.yaw, pitch: v.pitch }),
  deleteMedia: (media: string) => req<{ ok: boolean }>('DELETE', `/api/media/${media}`),
  exportCheck: (id: string) => req<{ ok: boolean; error?: string }>('GET', `/api/tours/${id}/export?check=1`),
  exportUrl: (id: string) => `/api/tours/${id}/export`,

  upload(tourId: string, file: File, onProgress: (p: number) => void): Promise<MediaInfo> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file, file.name);
      xhr.open('POST', `/api/tours/${tourId}/media`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let res: { error?: string } & Partial<MediaInfo> = {};
        try { res = JSON.parse(xhr.responseText); } catch { /* vide */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(res as MediaInfo);
        else reject(new Error(res.error || `Erreur ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Réseau indisponible'));
      xhr.send(fd);
    });
  },
};
