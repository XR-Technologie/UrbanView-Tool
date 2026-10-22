import { useEffect, useMemo, useRef, useState } from 'react';
import { rotate, sceneOfPoint, type TourPlan } from '../plan';
import type { Scene, TourData } from '../types';
import { Icon } from './Icon';

interface Props {
  data: TourData;
  plan: TourPlan | undefined;
  selected: string | null;
  thumbOf: (s: Scene) => string;
  onSelect: (pointId: string | null) => void;
  onDropScene: (pointId: string, sceneId: string) => void;
  onImport: (f: File) => void;
}

interface Box { x: number; y: number; w: number; h: number }

/** Relevé vu de dessus, dans un espace vide (sans carte) : points, chemin, objectif, photo reliée. */
export function PlanView({ data, plan, selected, thumbOf, onSelect, onDropScene, onImport }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box>({ x: -10, y: -10, w: 20, h: 20 });
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<{ inv: DOMMatrix; x: number; y: number; box: Box } | null>(null);
  const rot = plan?.anchor?.rotation ?? 0;

  // Coordonnées écran (SVG, y vers le bas), nord en haut une fois le plan calé
  const pts = useMemo(() => (plan?.points ?? []).map(p => {
    const [x, y] = rotate(p.x, p.y, rot);
    return { p, sx: x, sy: -y, scene: sceneOfPoint(data, p.id) };
  }).sort((a, b) => a.p.n - b.p.n), [plan, rot, data]);

  // Cadrage initial (et à chaque nouveau relevé / rotation)
  const fitKey = `${plan?.createdAt}|${plan?.points.length}|${Math.round(rot)}`;
  useEffect(() => {
    if (!pts.length) return;
    const xs = pts.map(q => q.sx), ys = pts.map(q => q.sy);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = Math.max(2, Math.max(x1 - x0, y1 - y0) * 0.15);
    setBox({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const toSvg = (e: { clientX: number; clientY: number }, inv?: DOMMatrix) => {
    const m = inv ?? svg.current!.getScreenCTM()!.inverse();
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: q.x, y: q.y };
  };

  // Zoom molette autour du curseur
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = toSvg(e);
      const k = Math.exp(e.deltaY * 0.0015);
      setBox(b => {
        const w = Math.min(2000, Math.max(1, b.w * k)), f = w / b.w;
        return { x: c.x - (c.x - b.x) * f, y: c.y - (c.y - b.y) * f, w, h: b.h * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [plan]);

  if (!plan) {
    return (
      <div className="rl-view">
        <label className="rl-empty">
          <Icon n="plan" size={56} />
          <span className="btn pri big"><Icon n="upload" />Importer un relevé</span>
          <input type="file" accept=".uvplan,.json,.txt,application/json,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </label>
      </div>
    );
  }

  const r = Math.max(box.w, box.h) * 0.022;
  const step = [1, 2, 5, 10, 20, 50, 100].find(s => Math.max(box.w, box.h) / s <= 60) ?? 200;
  const grid: JSX.Element[] = [];
  for (let x = Math.ceil(box.x / step) * step; x <= box.x + box.w; x += step) grid.push(<line key={`x${x}`} x1={x} x2={x} y1={box.y} y2={box.y + box.h} />);
  for (let y = Math.ceil(box.y / step) * step; y <= box.y + box.h; y += step) grid.push(<line key={`y${y}`} y1={y} y2={y} x1={box.x} x2={box.x + box.w} />);

  const dist = (a: (typeof pts)[0], b: (typeof pts)[0]) =>
    Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);

  return (
    <div className="rl-view">
      <svg
        ref={svg}
        className="rl-svg"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={e => {
          if ((e.target as Element).closest('.rl-pt')) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const inv = svg.current!.getScreenCTM()!.inverse();
          const c = toSvg(e, inv);
          drag.current = { inv, x: c.x, y: c.y, box };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          const c = toSvg(e, d.inv);
          setBox({ ...d.box, x: d.box.x - (c.x - d.x), y: d.box.y - (c.y - d.y) });
        }}
        onPointerUp={e => {
          const d = drag.current;
          drag.current = null;
          if (d) { const c = toSvg(e, d.inv); if (Math.hypot(c.x - d.x, c.y - d.y) < r * 0.3) onSelect(null); }
        }}
      >
        <g className="rl-grid">{grid}</g>

        <polyline className="rl-path" points={pts.map(q => `${q.sx},${q.sy}`).join(' ')} />
        {pts.slice(1).map((q, i) => {
          const a = pts[i];
          return (
            <text key={`d${q.p.id}`} className="rl-dist" x={(a.sx + q.sx) / 2} y={(a.sy + q.sy) / 2} fontSize={r * 0.62}>
              {dist(a, q).toFixed(1)} m
            </text>
          );
        })}

        {pts.map(({ p, sx, sy, scene }) => {
          const sel = p.id === selected;
          const anchor = plan.anchor?.pointId === p.id;
          const a = p.yaw == null ? null : ((p.yaw + rot) * Math.PI) / 180;
          return (
            <g
              key={p.id}
              className={'rl-pt' + (sel ? ' sel' : '') + (over === p.id ? ' over' : '') + (scene ? ' linked' : '')}
              transform={`translate(${sx} ${sy})`}
              onClick={() => onSelect(p.id)}
              onDragOver={e => { e.preventDefault(); setOver(p.id); }}
              onDragLeave={() => setOver(o => (o === p.id ? null : o))}
              onDrop={e => {
                e.preventDefault();
                e.stopPropagation();
                setOver(null);
                const sid = e.dataTransfer.getData('text/plain');
                if (sid) onDropScene(p.id, sid);
              }}
            >
              {a != null && (
                <path
                  className="rl-cone"
                  d={`M0 0 L${Math.sin(a - 0.42) * r * 3} ${-Math.cos(a - 0.42) * r * 3} A${r * 3} ${r * 3} 0 0 1 ${Math.sin(a + 0.42) * r * 3} ${-Math.cos(a + 0.42) * r * 3} Z`}
                />
              )}
              <clipPath id={`rlc-${p.id}`}><circle r={r} /></clipPath>
              <circle className="rl-dot" r={r * 1.18} />
              {scene && <image href={thumbOf(scene)} x={-r * 1.78} y={-r} width={r * 3.56} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#rlc-${p.id})`} />}
              <g transform={`translate(${r * 0.95} ${-r * 0.95})`}>
                <circle className={'rl-num' + (anchor ? ' anchor' : '')} r={r * 0.62} />
                <text className="rl-num-t" fontSize={r * 0.72} dy={r * 0.25}>{p.n}</text>
              </g>
            </g>
          );
        })}
      </svg>
      <div className="rl-scale glass">{step} m</div>
      {plan.anchor && <div className="rl-north glass"><Icon n="compass" />N</div>}
    </div>
  );
}
