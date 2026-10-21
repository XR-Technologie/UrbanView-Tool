import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { PanoView } from '../engine/PanoView';
import { DEG, clamp } from '../engine/math';
import type { Hotspot } from '../types';
import { Icon } from './Icon';

interface Props {
  pv: PanoView | null;
  hotspots: Hotspot[];
  selected?: string | null;
  editable?: boolean;
  onActivate?: (h: Hotspot) => void;
  onSelect?: (id: string) => void;
  onMove?: (id: string, yaw: number, pitch: number) => void;
}

/** Points interactifs positionnés à chaque image par la visionneuse (aucune infobulle au survol). */
export function HotspotLayer({ pv, hotspots, selected, editable, onActivate, onSelect, onMove }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const list = useRef(hotspots);
  list.current = hotspots;
  const updateRef = useRef<() => void>(() => {});
  const drag = useRef<{ id: string; pid: number; sx: number; sy: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!pv) return;
    const update = () => {
      layer.current?.classList.toggle('hidden', pv.busy || pv.cam.stereo > 0.02);
      for (const h of list.current) {
        const el = refs.current.get(h.id);
        if (!el) continue;
        const p = pv.project(h.yaw, h.pitch);
        if (!p) { el.style.visibility = 'hidden'; continue; }
        el.style.visibility = '';
        let s: number, sq = 1;
        if (h.type === 'link' && h.style === 'floor') {
          const dep = Math.max(-h.pitch, 0.06);
          sq = clamp(Math.sin(dep) * 1.25, 0.22, 1);
          s = clamp(clamp(Math.sin(dep) / Math.sin(28 * DEG), 0.4, 1.6) * p.zoom, 0.3, 2.4);
        } else {
          s = clamp(p.zoom, 0.75, 1.5);
        }
        el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        el.style.setProperty('--s', s.toFixed(3));
        el.style.setProperty('--sq', sq.toFixed(3));
        el.style.zIndex = String(Math.round(1000 - p.z * 500));
      }
    };
    updateRef.current = update;
    update();
    return pv.subscribe(update);
  }, [pv]);

  useLayoutEffect(() => { updateRef.current(); });

  return (
    <div className="hs-layer" ref={layer}>
      {hotspots.map((h, i) => (
        <div
          key={h.id}
          data-hs
          ref={el => { if (el) refs.current.set(h.id, el); else refs.current.delete(h.id); }}
          className={`hs hs--${h.type === 'info' ? 'info' : h.style}${selected === h.id ? ' sel' : ''}`}
          style={{ '--d': `${i * 70}ms` } as CSSProperties}
          onPointerDown={e => {
            e.stopPropagation();
            if (!editable) return;
            onSelect?.(h.id);
            drag.current = { id: h.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            const d = drag.current;
            if (!d || d.pid !== e.pointerId || !pv) return;
            if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
            d.moved = true;
            const r = pv.screenToDir(e.clientX, e.clientY);
            onMove?.(d.id, r.yaw, r.pitch);
          }}
          onPointerUp={() => { drag.current = null; }}
          onClick={e => { e.stopPropagation(); if (!editable) onActivate?.(h); }}
        >
          {h.type === 'info' ? (
            <div className="hs-info">i</div>
          ) : h.style === 'pin' ? (
            <div className="hs-pin"><Icon n="arrowUp" /></div>
          ) : (
            <div className="hs-floor"><i className="hs-rb" /><i className="hs-ring" /><i className="hs-pulse" /></div>
          )}
        </div>
      ))}
    </div>
  );
}
