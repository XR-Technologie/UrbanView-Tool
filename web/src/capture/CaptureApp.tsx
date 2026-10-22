import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { norm360 } from '../geo';
import type { PlanPoint } from '../plan';
import { uid } from '../types';
import {
  dirToPlan, dist2, exportSurvey, loadSurveys, saveSurveys, toLocal, toPlan, xfFromFirst, xfFromPairs,
  type Survey, type Xf,
} from './survey';
import { ArTracker, arSupported, startCompass, type FrameInfo, type Ring, type V3 } from './xr';

type Phase = 'align' | 'point' | 'lens';

const BLUE: Ring['color'] = [0.16, 0.55, 0.82, 0.9];
const AMBER: Ring['color'] = [1, 0.77, 0.24, 0.95];
const fmt = (m: number) => `${m.toFixed(2).replace('.', ',')} m`;
const byN = (pts: PlanPoint[]) => [...pts].sort((a, b) => a.n - b.n);

export default function CaptureApp() {
  const [list, setList] = useState<Survey[]>(loadSurveys);
  const [openId, setOpenId] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [ar, setAr] = useState<ArTracker | null>(null);
  const [phase, setPhase] = useState<Phase>('point');
  const [aligned, setAligned] = useState<V3[]>([]);
  const [msg, setMsg] = useState('');
  const [, setTick] = useState(0);
  const frame = useRef<FrameInfo>({ floor: null, pos: null, fwd: null, tracking: false });
  const xf = useRef<Xf | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const compass = useRef<ReturnType<typeof startCompass> | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => { arSupported().then(setSupported); }, []);
  useEffect(() => { saveSurveys(list); }, [list]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3200);
    return () => clearTimeout(t);
  }, [msg]);

  // Rafraîchissement de l'interface AR (distance, réticule) ~8 fois par seconde
  useEffect(() => {
    if (!ar) return;
    const t = setInterval(() => setTick(x => x + 1), 120);
    return () => clearInterval(t);
  }, [ar]);

  const survey = list.find(s => s.id === openId) ?? null;
  const pts = survey ? byN(survey.points) : [];
  const update = (fn: (s: Survey) => Survey) => setList(l => l.map(s => (s.id === openId ? fn(s) : s)));

  // Anneaux au sol : points déjà relevés + direction de l'objectif
  useEffect(() => {
    if (!ar) return;
    const x = xf.current;
    if (!x || phase === 'align') { ar.rings = []; return; }
    ar.rings = pts.flatMap((p, i) => {
      const c = toLocal(x, p);
      const last = i === pts.length - 1;
      const out: Ring[] = [{ p: c, r: 0.16, color: last ? AMBER : BLUE }];
      if (p.yaw != null) {
        for (let k = 1; k <= 3; k++) {
          const d = 0.18 + k * 0.14, a = ((p.yaw - x.rot) * Math.PI) / 180;
          out.push({ p: [c[0] + Math.sin(a) * d, c[1], c[2] - Math.cos(a) * d], r: 0.035, color: last ? AMBER : BLUE });
        }
      }
      return out;
    });
  });

  /* ---------- AR ---------- */
  const startAr = async () => {
    if (!survey || !overlay.current) return;
    if (pts.length === 1) {
      if (!confirm('Un seul point : le relevé repart de zéro.')) return;
      update(s => ({ ...s, points: [] }));
    }
    try {
      const t = await ArTracker.start(overlay.current);
      xf.current = null;
      t.onFrame = f => { frame.current = f; };
      t.onEnd = () => {
        setAr(null);
        xf.current = null;
        compass.current?.stop();
        wake.current?.release().catch(() => {});
        wake.current = null;
      };
      compass.current = startCompass();
      try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* écran : veille normale */ }
      setAligned([]);
      setPhase(pts.length >= 2 ? 'align' : 'point');
      setAr(t);
    } catch (e) {
      setMsg((e as Error).message || 'Réalité augmentée indisponible');
    }
  };

  const f = frame.current;
  const x = xf.current;
  const last = pts[pts.length - 1];
  const alignTargets = pts.slice(-2);
  const live = f.floor && x && last ? dist2(last, (([px, py]) => ({ x: px, y: py }))(toPlan(x, f.floor))) : null;

  const mark = () => {
    const floor = frame.current.floor;
    if (!floor || !survey) return;

    if (phase === 'align') {
      const next = [...aligned, floor];
      if (next.length < 2) { setAligned(next); return; }
      const { xf: nx, error } = xfFromPairs(alignTargets, next);
      if (error > 0.4) { setAligned([]); setMsg(`Écart ${fmt(error)} — recommencez`); return; }
      xf.current = nx;
      setAligned([]);
      setPhase('point');
      setMsg(`Recalé · ${fmt(error)}`);
      return;
    }

    if (phase === 'point') {
      if (!xf.current) xf.current = xfFromFirst(floor);
      const [px, py, pz] = toPlan(xf.current, floor);
      const p: PlanPoint = { id: uid(), n: (last?.n ?? 0) + 1, x: px, y: py, z: pz, yaw: null, t: Date.now() };
      const h = compass.current?.heading() ?? null;
      const a = frame.current.fwd ? dirToPlan(xf.current, frame.current.fwd) : null;
      update(s => ({ ...s, points: [...s.points, p], north: h != null && a != null ? [...s.north, norm360(h - a)] : s.north }));
      setPhase('lens');
      return;
    }

    // phase « lens » : direction du pied du trépied vers le point visé devant l'objectif
    if (!last || !xf.current) return;
    const c = toLocal(xf.current, last);
    const d: V3 = [floor[0] - c[0], 0, floor[2] - c[2]];
    let yaw = Math.hypot(d[0], d[2]) > 0.25 ? dirToPlan(xf.current, d) : null;
    if (yaw == null && frame.current.fwd) yaw = dirToPlan(xf.current, frame.current.fwd);
    if (yaw == null) { setMsg('Visez le sol devant l’objectif'); return; }
    update(s => ({ ...s, points: s.points.map(q => (q.id === last.id ? { ...q, yaw } : q)) }));
    setPhase('point');
  };

  const undo = () => {
    if (phase === 'align') { setAligned([]); return; }
    if (!last) return;
    update(s => ({ ...s, points: s.points.filter(q => q.id !== last.id) }));
    if (pts.length === 1) xf.current = null;
    setPhase('point');
  };

  /* ---------- écrans ---------- */
  const hint = phase === 'align'
    ? `Visez le point ${alignTargets[aligned.length]?.n}`
    : phase === 'lens' ? 'Visez le sol devant l’objectif' : 'Visez le pied du trépied';

  const arUi = (
    <div ref={overlay} className="ar" style={{ display: ar ? undefined : 'none' }}>
      {ar && (
        <>
          <div className="ar-top">
            <button className="ar-ic" onClick={() => ar.end()}><Icon n="close" /></button>
            <span className="ar-count">{pts.length}</span>
            <div className="grow" />
            <MiniPlan points={pts} here={f.pos && x ? toPlan(x, f.pos) : null} />
          </div>
          <div className={'ar-cross' + (f.floor ? ' ok' : '')} />
          {!f.tracking && <div className="ar-warn">Suivi perdu — bougez lentement</div>}
          {msg && <div className="ar-msg">{msg}</div>}
          <div className="ar-bottom">
            <div className={'ar-hint' + (phase !== 'point' ? ' alt' : '')}>
              {hint}
              {phase === 'point' && live != null && <b>{fmt(live)}</b>}
            </div>
            <div className="ar-actions">
              <button className="ar-ic big2" onClick={undo} disabled={phase !== 'align' && !last}><Icon n="undo" /></button>
              <button className={'ar-main ' + phase} disabled={!f.floor || !f.tracking} onClick={mark}>
                <Icon n={phase === 'point' ? 'plus' : phase === 'lens' ? 'arrowUp' : 'target'} size={34} />
              </button>
              {phase === 'lens'
                ? <button className="ar-ic big2" onClick={() => setPhase('point')}><Icon n="close" /></button>
                : <span className="ar-ic big2 ghost" />}
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (survey) {
    return (
      <div className="cap">
        <header className="cap-top">
          <button className="cap-ic" onClick={() => setOpenId(null)}><Icon n="back" /></button>
          <input className="cap-name" value={survey.name} onChange={e => update(s => ({ ...s, name: e.target.value }))} />
          <button className="cap-ic danger" onClick={() => { if (confirm('Supprimer ce relevé ?')) { setList(l => l.filter(s => s.id !== survey.id)); setOpenId(null); } }}><Icon n="trash" /></button>
        </header>
        <div className="cap-plan">
          {pts.length ? <MiniPlan points={pts} big /> : <Icon n="plan" size={64} />}
          <span className="cap-badge">{pts.length} pt{pts.length > 1 ? 's' : ''}</span>
        </div>
        <div className="cap-actions">
          <button className="cap-btn pri" disabled={!supported} onClick={startAr}>
            <Icon n="target" />{pts.length ? 'Continuer' : 'Démarrer'}
          </button>
          <div className="cap-row">
            <button className="cap-btn" disabled={!pts.length} onClick={() => exportSurvey(survey, 'share')}><Icon n="share" />Envoyer</button>
            <button className="cap-btn" disabled={!pts.length} onClick={() => exportSurvey(survey, 'download')}><Icon n="download" /></button>
          </div>
          {supported === false && <div className="cap-warn">Réalité augmentée non disponible : Chrome Android + ARCore requis.</div>}
        </div>
        {msg && <div className="cap-toast">{msg}</div>}
        {arUi}
      </div>
    );
  }

  return (
    <div className="cap">
      <header className="cap-top">
        <span className="cap-logo">URBAN VIEW <b>360</b> <i>XR</i></span>
        <div className="grow" />
        <span className="cap-sub">Relevé</span>
      </header>
      <div className="cap-list">
        {[...list].sort((a, b) => b.createdAt - a.createdAt).map(s => (
          <button key={s.id} className="cap-item" onClick={() => setOpenId(s.id)}>
            <MiniPlan points={byN(s.points)} />
            <span className="grow">
              <b>{s.name}</b>
              <small>{s.points.length} pt{s.points.length > 1 ? 's' : ''} · {new Date(s.createdAt).toLocaleDateString('fr-FR')}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="cap-actions">
        <button
          className="cap-btn pri"
          onClick={() => {
            const s: Survey = { id: uid(), name: `Relevé ${new Date().toLocaleDateString('fr-FR')}`, createdAt: Date.now(), points: [], north: [] };
            setList(l => [...l, s]);
            setOpenId(s.id);
          }}
        >
          <Icon n="plus" />Nouveau relevé
        </button>
        {supported === false && <div className="cap-warn">Réalité augmentée non disponible : Chrome Android + ARCore requis.</div>}
      </div>
    </div>
  );
}

/** Aperçu du relevé vu de dessus (ajusté à la taille). */
function MiniPlan({ points, here, big }: { points: PlanPoint[]; here?: [number, number, number] | null; big?: boolean }) {
  const all = [...points.map(p => [p.x, p.y]), ...(here ? [[here[0], here[1]]] : [])];
  if (!all.length) return <svg className={'mini' + (big ? ' big' : '')} viewBox="-1 -1 2 2" />;
  const xs = all.map(p => p[0]), ys = all.map(p => -p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0, 3), pad = size * 0.14;
  const vb = `${(x0 + x1) / 2 - size / 2 - pad} ${(y0 + y1) / 2 - size / 2 - pad} ${size + pad * 2} ${size + pad * 2}`;
  const r = (size + pad * 2) * (big ? 0.03 : 0.06);
  return (
    <svg className={'mini' + (big ? ' big' : '')} viewBox={vb}>
      <polyline points={points.map(p => `${p.x},${-p.y}`).join(' ')} />
      {points.map(p => (
        <g key={p.id} transform={`translate(${p.x} ${-p.y})`}>
          {p.yaw != null && <line x2={Math.sin((p.yaw * Math.PI) / 180) * r * 2.4} y2={-Math.cos((p.yaw * Math.PI) / 180) * r * 2.4} />}
          <circle r={r} />
          {big && <text fontSize={r * 1.3} dy={r * 0.45}>{p.n}</text>}
        </g>
      ))}
      {here && <circle className="here" cx={here[0]} cy={-here[1]} r={r * 0.8} />}
    </svg>
  );
}
