import { useCallback, useEffect, useRef, useState } from 'react';
import { DEG, PI, clamp } from '../engine/math';
import type { Scene, View } from '../types';
import { Icon } from './Icon';

type Tool = 'erase' | 'blur' | 'hand';
type Quality = 'low' | 'full';

/** Client promesse du worker de retouche. */
class RetouchClient {
  private w = new Worker(new URL('../engine/retouch.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { res: (v: never) => void; rej: (e: Error) => void }>();
  onProgress?: (p: number) => void;

  constructor() {
    this.w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { this.onProgress?.(m.p); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error));
      else p.res(m as never);
    };
  }
  call<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: never) => void, rej });
      this.w.postMessage({ ...msg, id }, transfer);
    });
  }
  destroy() { this.w.terminate(); }
}

interface Props {
  scene: Scene;
  sourceUrl: string;
  startView: View;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void>;
  onRestore?: () => void;
}

/** Studio de retouche : flou (visages, plaques) et effacement intelligent (trépied, objets). */
export function RetouchStudio({ scene, sourceUrl, startView, onCancel, onSave, onRestore }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewCv = useRef<HTMLCanvasElement>(null);
  const maskCv = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const client = useRef<RetouchClient | null>(null);
  const loaded = useRef(false);
  const view = useRef<View>({ ...startView, fov: clamp(startView.fov, 30, 110) });
  const dims = useRef({ w: 1, h: 1, cssW: 1, cssH: 1, scale: 1 });
  const rq = useRef<{ running: boolean; next: Quality | null }>({ running: false, next: null });
  const ptr = useRef<{ mode: 'pan' | 'paint'; x: number; y: number } | null>(null);
  const wheelT = useRef<number | undefined>(undefined);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(70);
  const [strength, setStrength] = useState(20);
  const [undo, setUndo] = useState(0);
  const [saving, setSaving] = useState(false);
  const [spaceHand, setSpaceHand] = useState(false);

  const panning = tool === 'hand' || spaceHand;

  /* ---------- rendu ---------- */
  const renderOnce = useCallback(async (q: Quality) => {
    const c = client.current, cv = viewCv.current;
    if (!c || !cv || !loaded.current) return;
    const { w, h } = dims.current;
    const f = q === 'low' ? 0.35 : 1;
    const rw = Math.max(16, Math.round(w * f)), rh = Math.max(16, Math.round(h * f));
    const r = await c.call<{ buf: ArrayBuffer; w: number; h: number }>({ type: 'render', view: { ...view.current }, w: rw, h: rh });
    const img = new ImageData(new Uint8ClampedArray(r.buf), r.w, r.h);
    const g = cv.getContext('2d')!;
    if (r.w === cv.width && r.h === cv.height) g.putImageData(img, 0, 0);
    else {
      const tmp = new OffscreenCanvas(r.w, r.h);
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      g.imageSmoothingQuality = 'high';
      g.drawImage(tmp, 0, 0, cv.width, cv.height);
    }
  }, []);

  const requestRender = useCallback((q: Quality) => {
    const st = rq.current;
    if (st.running) { st.next = q; return; }
    st.running = true;
    (async () => {
      let cur: Quality | null = q;
      while (cur) {
        try { await renderOnce(cur); } catch { /* vue ignorée */ }
        cur = st.next;
        st.next = null;
      }
      st.running = false;
    })();
  }, [renderOnce]);

  /* ---------- worker + taille ---------- */
  useEffect(() => {
    const c = new RetouchClient();
    c.onProgress = p => setBusy(p);
    client.current = c;
    c.call({ type: 'load', url: sourceUrl })
      .then(() => { loaded.current = true; setReady(true); requestRender('full'); })
      .catch(e => setError((e as Error).message));
    return () => { c.destroy(); client.current = null; };
  }, [sourceUrl, requestRender]);

  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const cssW = el.clientWidth || 1, cssH = el.clientHeight || 1;
      const scale = Math.min(window.devicePixelRatio || 1, 2048 / Math.max(cssW, cssH));
      const w = Math.round(cssW * scale), h = Math.round(cssH * scale);
      dims.current = { w, h, cssW, cssH, scale };
      for (const cv of [viewCv.current, maskCv.current]) { if (cv) { cv.width = w; cv.height = h; } }
      requestRender('full');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [requestRender]);

  /* ---------- actions ---------- */
  const commit = async () => {
    const mc = maskCv.current, c = client.current;
    if (!mc || !c) return;
    const { w, h, scale } = dims.current;
    const g = mc.getContext('2d', { willReadFrequently: true })!;
    const data = g.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < mask.length; i++) if (data[i * 4 + 3] > 20) { mask[i] = 1; any = true; }
    if (!any) return;
    setBusy(0);
    try {
      const r = await c.call<{ undo: number }>(
        { type: 'apply', view: { ...view.current }, w, h, mode: tool === 'blur' ? 'blur' : 'erase', sigma: strength * scale, mask: mask.buffer },
        [mask.buffer],
      );
      setUndo(r.undo);
      await renderOnce('full');
    } catch (e) {
      setError((e as Error).message);
    }
    g.clearRect(0, 0, w, h);
    setBusy(null);
  };

  const doUndo = async () => {
    if (!client.current || busy !== null || !undo) return;
    const r = await client.current.call<{ undo: number }>({ type: 'undo' });
    setUndo(r.undo);
    await renderOnce('full');
  };

  const save = async () => {
    if (!client.current) return;
    setSaving(true);
    try {
      const r = await client.current.call<{ blob: Blob }>({ type: 'encode' });
      await onSave(r.blob);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const cancel = () => { if (!undo || confirm('Abandonner les retouches non enregistrées ?')) onCancel(); };

  const lookAt = (pitch: number, fov: number) => { view.current = { ...view.current, pitch, fov }; requestRender('full'); };

  /* ---------- clavier ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as Element).closest('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); setSpaceHand(true); }
      else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); doUndo(); }
      else if (k === 'e') setTool('erase');
      else if (k === 'b') setTool('blur');
      else if (k === 'h') setTool('hand');
      else if (k === '[') setBrush(b => Math.max(8, Math.round(b / 1.2)));
      else if (k === ']') setBrush(b => Math.min(400, Math.round(b * 1.2)));
      else if (k === 'escape') cancel();
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceHand(false); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  });

  /* ---------- pointeur ---------- */
  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const moveCursor = (x: number, y: number) => {
    const c = cursorRef.current;
    if (c) c.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ready || busy !== null || saving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    if (panning || e.button !== 0) { ptr.current = { mode: 'pan', x: p.x, y: p.y }; return; }
    ptr.current = { mode: 'paint', x: p.x, y: p.y };
    const g = maskCv.current!.getContext('2d')!;
    const s = dims.current.scale;
    g.strokeStyle = tool === 'blur' ? '#2a8bd0' : '#ff2d55';
    g.lineWidth = brush * s;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(p.x * s, p.y * s);
    g.lineTo(p.x * s + 0.01, p.y * s);
    g.stroke();
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    moveCursor(p.x, p.y);
    const st = ptr.current;
    if (!st) return;
    if (st.mode === 'pan') {
      const k = (view.current.fov * DEG) / dims.current.cssH;
      view.current = {
        ...view.current,
        yaw: view.current.yaw - (p.x - st.x) * k,
        pitch: clamp(view.current.pitch + (p.y - st.y) * k, -PI / 2, PI / 2),
      };
      requestRender('low');
    } else {
      const g = maskCv.current!.getContext('2d')!;
      const s = dims.current.scale;
      g.beginPath();
      g.moveTo(st.x * s, st.y * s);
      g.lineTo(p.x * s, p.y * s);
      g.stroke();
    }
    st.x = p.x;
    st.y = p.y;
  };

  const onUp = () => {
    const st = ptr.current;
    ptr.current = null;
    if (!st) return;
    if (st.mode === 'pan') requestRender('full');
    else commit();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!ready || busy !== null) return;
    view.current = { ...view.current, fov: clamp(view.current.fov * (1 + e.deltaY * 0.0011), 20, 120) };
    requestRender('low');
    clearTimeout(wheelT.current);
    wheelT.current = window.setTimeout(() => requestRender('full'), 160);
  };

  return (
    <div className="rt">
      <header className="rt-top">
        <span className="insp-ic"><Icon n="brush" /></span>
        <b>Retouche</b>
        <span className="muted">{scene.name}</span>
        <div className="grow" />
        <button className="ibtn" title="Annuler (Ctrl+Z)" disabled={!undo || busy !== null} onClick={doUndo}><Icon n="undo" /></button>
        {onRestore && <button className="btn ghost" onClick={onRestore} title="Revenir à la photo d'origine"><Icon n="reset" />Original</button>}
        <button className="btn ghost" onClick={cancel}>Fermer</button>
        <button className="btn pri" disabled={!undo || saving || busy !== null} onClick={save}>
          {saving ? <span className="spinner sm" /> : <Icon n="check" />}Enregistrer
        </button>
      </header>

      <div className="rt-body">
        <div
          ref={stageRef}
          className={'rt-stage' + (panning ? ' pan' : '')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={onWheel}
          onContextMenu={e => e.preventDefault()}
        >
          <canvas ref={viewCv} />
          <canvas ref={maskCv} className={'rt-mask ' + (tool === 'blur' ? 'blur' : 'erase')} />
          {!panning && <div ref={cursorRef} className="rt-cursor" style={{ width: brush, height: brush }} />}
          {(!ready || busy !== null) && !error && (
            <div className="rt-busy">
              <span className="spinner" />
              {busy !== null && <div className="rt-bar"><i style={{ width: `${Math.round(busy * 100)}%` }} /></div>}
            </div>
          )}
          {error && <div className="rt-busy"><p className="err">{error}</p><button className="btn" onClick={() => setError('')}>OK</button></div>}
        </div>

        <aside className="rt-panel">
          <div className="rt-tools">
            <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')} title="Effacer (E)"><Icon n="eraser" />Effacer</button>
            <button className={tool === 'blur' ? 'on' : ''} onClick={() => setTool('blur')} title="Flouter (B)"><Icon n="drop" />Flouter</button>
            <button className={tool === 'hand' ? 'on' : ''} onClick={() => setTool('hand')} title="Vue (H ou Espace)"><Icon n="hand" />Vue</button>
          </div>

          <div className="field">
            <label>Pinceau · {brush}px</label>
            <input type="range" min={8} max={400} value={brush} onChange={e => setBrush(+e.target.value)} />
          </div>
          {tool === 'blur' && (
            <div className="field">
              <label>Intensité · {strength}</label>
              <input type="range" min={4} max={60} value={strength} onChange={e => setStrength(+e.target.value)} />
            </div>
          )}

          <div className="insp-h" style={{ marginTop: 18 }}>Vue</div>
          <div className="row3">
            <button className="btn" onClick={() => lookAt(-PI / 2, 100)} title="Sol (trépied)"><Icon n="arrowDown" />Sol</button>
            <button className="btn" onClick={() => lookAt(0, 75)} title="Horizon"><Icon n="horizon" /></button>
            <button className="btn" onClick={() => lookAt(PI / 2, 100)} title="Plafond"><Icon n="arrowUp" /></button>
          </div>
        </aside>
      </div>
    </div>
  );
}
