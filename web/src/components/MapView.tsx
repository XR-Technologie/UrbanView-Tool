import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bridges, headingOf } from '../geo';
import type { Scene, TourData } from '../types';
import { Icon } from './Icon';

export type MapTool = 'select' | 'place' | 'link' | 'anchor';

/** Point du relevé projeté sur la carte. */
export interface PlanGhost { id: string; n: number; lat: number; lng: number; linked: boolean }

interface Props {
  data: TourData;
  selected: string | null;
  tool: MapTool;
  thumbOf: (s: Scene) => string;
  onSelect: (id: string) => void;
  onPlace: (lat: number, lng: number) => void;
  onMove: (id: string, lat: number, lng: number) => void;
  onLink: (a: string, b: string) => void;
  onUnlink: (a: string, b: string) => void;
  /** Relevé calé : chemin + points sans photo. */
  ghosts?: PlanGhost[];
  /** Outil « anchor » : numéro du point à poser. */
  anchorN?: number;
  onAnchor?: (lat: number, lng: number) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Carte (Leaflet) : positions des photos, orientation, ponts. */
export function MapView({ data, selected, tool, thumbOf, onSelect, onPlace, onMove, onLink, onUnlink, ghosts, anchorN, onAnchor }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const cb = useRef({ onSelect, onPlace, onMove, onLink, onUnlink, onAnchor, tool, pending });
  cb.current = { onSelect, onPlace, onMove, onLink, onUnlink, onAnchor, tool, pending };

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: false, attributionControl: true, maxZoom: 21 }).setView([46.6, 2.4], 6);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap',
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21, maxNativeZoom: 19, attribution: '© Esri, Maxar',
    });
    sat.addTo(m);
    L.control.layers({ Satellite: sat, Plan: osm }, undefined, { position: 'bottomright' }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', e => {
      const c = cb.current;
      if (c.tool === 'place') c.onPlace(e.latlng.lat, e.latlng.lng);
      else if (c.tool === 'anchor') c.onAnchor?.(e.latlng.lat, e.latlng.lng);
      else setPending(null);
    });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => { if (tool !== 'link') setPending(null); }, [tool]);

  // Rendu des photos et des ponts
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();

    if (ghosts?.length) {
      g.addLayer(L.polyline(ghosts.map(p => [p.lat, p.lng] as L.LatLngTuple), { color: '#ffc53d', weight: 2, opacity: 0.8, dashArray: '4 6', interactive: false }));
      for (const p of ghosts) {
        if (p.linked) continue;
        g.addLayer(L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: `<div class="mk-ghost">${p.n}</div>`, className: 'mk-wrap', iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: false,
        }));
      }
    }

    for (const [a, b] of bridges(data)) {
      const line = L.polyline([[a.geo!.lat, a.geo!.lng], [b.geo!.lat, b.geo!.lng]], { color: '#2a8bd0', weight: 5, opacity: 0.9, className: 'map-bridge' });
      line.bindTooltip(`${a.name} ↔ ${b.name}`, { sticky: true });
      line.on('click', e => {
        L.DomEvent.stopPropagation(e);
        if (confirm(`Supprimer le pont « ${a.name} ↔ ${b.name} » ?`)) cb.current.onUnlink(a.id, b.id);
      });
      g.addLayer(line);
    }

    const pts: L.LatLngExpression[] = [];
    for (const s of data.scenes) {
      if (!s.geo) continue;
      pts.push([s.geo.lat, s.geo.lng]);
      const hd = headingOf(data, s);
      const cls = ['mk', s.id === selected ? 'sel' : '', s.id === pending ? 'pend' : '', s.geo.heading == null ? 'auto' : ''].join(' ');
      const html = `<div class="${cls}">${hd != null ? `<span class="mk-cone" style="transform:rotate(${hd.toFixed(1)}deg)"></span>` : ''}`
        + `<img src="${esc(thumbOf(s))}" alt="" draggable="false"/></div>`;
      const mk = L.marker([s.geo.lat, s.geo.lng], {
        icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [46, 46], iconAnchor: [23, 23] }),
        draggable: true,
        title: s.name,
        riseOnHover: true,
      });
      mk.on('click', () => {
        const c = cb.current;
        if (c.tool === 'link') {
          if (!c.pending) setPending(s.id);
          else if (c.pending !== s.id) { c.onLink(c.pending, s.id); setPending(s.id); }
        } else c.onSelect(s.id);
      });
      mk.on('dragend', () => { const p = mk.getLatLng(); cb.current.onMove(s.id, p.lat, p.lng); });
      g.addLayer(mk);
    }

    if (!fitted.current && pts.length) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 20 });
    }
  }, [data, selected, pending, thumbOf, ghosts]);

  useEffect(() => {
    const el = host.current;
    if (el) el.style.cursor = tool === 'place' || tool === 'anchor' ? 'crosshair' : '';
  }, [tool]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !map.current) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const [hit] = await r.json() as { lat: string; lon: string }[];
      if (hit) map.current.flyTo([+hit.lat, +hit.lon], 19);
    } catch { /* hors ligne */ }
  };

  const focusSelected = () => {
    const s = data.scenes.find(x => x.id === selected);
    if (s?.geo && map.current) map.current.flyTo([s.geo.lat, s.geo.lng], Math.max(map.current.getZoom(), 19));
  };

  return (
    <div className="map-view">
      <div className="map-host" ref={host} />
      <form className="map-search glass" onSubmit={search}>
        <Icon n="search" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Adresse…" />
        <button type="button" className="ibtn sm" title="Centrer sur la photo" onClick={focusSelected}><Icon n="target" /></button>
      </form>
      {tool === 'link' && <div className="map-hint glass">{pending ? 'Cliquez la photo suivante' : 'Cliquez une première photo'}</div>}
      {tool === 'place' && <div className="map-hint glass">Cliquez sur la carte pour placer la photo</div>}
      {tool === 'anchor' && <div className="map-hint glass">Cliquez l’emplacement du point {anchorN}</div>}
    </div>
  );
}
