import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { HotspotLayer } from '../components/HotspotLayer';
import { Icon } from '../components/Icon';
import { UrbanviewInline, UrbanviewLogo } from '../components/Logo';
import { RetouchStudio } from '../components/RetouchStudio';
import { PanoView, type View } from '../engine/PanoView';
import { PI, normAng } from '../engine/math';
import {
  arrivalFor, isLink, normalizeDoc, sceneById, startSceneOf, uid,
  type Hotspot, type InfoHotspot, type LinkHotspot, type Scene, type TourData, type TourDoc, type TourSettings,
} from '../types';
import { InfoPanel, LinkPanel, ScenePanel, SettingsPanel, URL_FOR, thumbOf } from './EditorPanels';
import { StreetViewPanel } from './StreetViewPanel';
import { MapView, type MapTool, type PlanGhost } from '../components/MapView';
import { PlanView } from '../components/PlanView';
import { PlanPanel } from './PlanPanel';
import { addBridge, autoBridges, headingFromNorthView, headingOf, removeBridge } from '../geo';
import { applyPlan, matchByTime, parsePlan, planToGeo, rotationToward, sceneOfPoint } from '../plan';

type Tool = 'select' | 'link' | 'info';
interface Upload { key: string; name: string; progress: number; error?: string }

const cleanName = (f: string) => f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Espace';

export default function Editor() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<TourDoc | null>(null);
  const [err, setErr] = useState('');
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [hsId, setHsId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [settings, setSettings] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dropping, setDropping] = useState(false);
  const [toast, setToast] = useState('');
  const [pv, setPv] = useState<PanoView | null>(null);
  const [retouch, setRetouch] = useState<View | null>(null);
  const [stage, setStage] = useState<'360' | 'map' | 'plan'>('360');
  const [planSel, setPlanSel] = useState<string | null>(null);
  const [mapTool, setMapTool] = useState<MapTool>('select');
  const [svOpen, setSvOpen] = useState(false);
  const docRef = useRef<TourDoc | null>(null);
  docRef.current = doc;
  const glRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const pending = useRef<TourDoc | null>(null);
  const skipShow = useRef<string | null>(null);
  const dragScene = useRef<string | null>(null);
  const [overScene, setOverScene] = useState<string | null>(null);
  const tapRef = useRef<(x: number, y: number) => void>(() => {});

  const notify = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(t => (t === m ? '' : t)), 2600); }, []);

  /* ---------- chargement & sauvegarde automatique ---------- */
  useEffect(() => {
    api.tour(id)
      .then(d => { const n = normalizeDoc(d); setDoc(n); setSceneId(startSceneOf(n.data)?.id ?? null); })
      .catch(e => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    if (!loaded.current) { loaded.current = true; return; }
    pending.current = doc;
    setSaveState('saving');
    const t = setTimeout(() => {
      api.saveTour(doc.id, doc.title, doc.data)
        .then(() => { if (pending.current === doc) { pending.current = null; setSaveState('saved'); } })
        .catch(() => setSaveState('error'));
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) e.preventDefault(); };
    addEventListener('beforeunload', warn);
    return () => {
      removeEventListener('beforeunload', warn);
      const p = pending.current;
      if (p) api.saveTour(p.id, p.title, p.data).catch(() => {});
    };
  }, []);

  const mutate = useCallback((fn: (d: TourData) => void) => {
    setDoc(prev => {
      if (!prev) return prev;
      const data = structuredClone(prev.data);
      fn(data);
      return { ...prev, data };
    });
  }, []);

  /** Enregistre immédiatement (avant une publication par exemple). */
  const saveNow = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    await api.saveTour(d.id, d.title, d.data);
    if (pending.current === d) pending.current = null;
    setSaveState('saved');
  }, []);

  /* ---------- visionneuse ---------- */
  const hasDoc = !!doc;
  useEffect(() => {
    if (!hasDoc || !glRef.current) return;
    const v = new PanoView(glRef.current, { urlFor: URL_FOR });
    v.onTap = (x, y) => tapRef.current(x, y);
    setPv(v);
    return () => { v.destroy(); setPv(null); };
  }, [hasDoc]);

  const data = doc?.data;
  const scene = data ? sceneById(data, sceneId) : null;
  const hs = scene?.hotspots.find(h => h.id === hsId) ?? null;

  // Relevé calé : chemin et points projetés sur la carte
  const ghosts = useMemo<PlanGhost[] | undefined>(() => {
    if (!data?.plan?.anchor) return undefined;
    const geo = planToGeo(data.plan);
    return [...data.plan.points].sort((a, b) => a.n - b.n).flatMap(p => {
      const g = geo.get(p.id);
      return g ? [{ id: p.id, n: p.n, lat: g.lat, lng: g.lng, linked: !!sceneOfPoint(data, p.id) }] : [];
    });
  }, [data]);

  useEffect(() => {
    if (!pv) return;
    if (!scene) { pv.clear(); return; }
    if (skipShow.current === scene.id) { skipShow.current = null; return; }
    pv.show(scene.media, scene.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv, scene?.id, scene?.media]);

  // clic dans la photo : désélection ou placement d'un point
  tapRef.current = (x, y) => {
    if (!pv || !scene) return;
    if (tool === 'select') { setHsId(null); return; }
    const d = pv.screenToDir(x, y);
    const nid = uid();
    const h: Hotspot = tool === 'link'
      ? { id: nid, type: 'link', yaw: d.yaw, pitch: d.pitch, target: null, style: d.pitch < -0.12 ? 'floor' : 'pin', arrival: null }
      : { id: nid, type: 'info', yaw: d.yaw, pitch: d.pitch, title: 'Information', text: '', url: '' };
    mutate(dd => { sceneById(dd, scene.id)?.hotspots.push(h); });
    setHsId(nid);
    setTool('select');
    setSettings(false);
  };

  /* ---------- actions ---------- */
  const editHs = <T extends Hotspot>(sid: string, hid: string, fn: (h: T) => void) =>
    mutate(d => { const h = sceneById(d, sid)?.hotspots.find(x => x.id === hid); if (h) fn(h as T); });

  const deleteHs = (hid: string) => {
    if (!scene) return;
    mutate(d => { const s = sceneById(d, scene.id); if (s) s.hotspots = s.hotspots.filter(h => h.id !== hid); });
    setHsId(null);
  };

  const backlink = (h: LinkHotspot) => {
    if (!scene || !h.target) return;
    mutate(d => {
      const t = sceneById(d, h.target);
      if (!t || t.hotspots.some(x => isLink(x) && x.target === scene.id)) return;
      t.hotspots.push({ id: uid(), type: 'link', target: scene.id, yaw: normAng(h.yaw + PI), pitch: h.pitch, style: h.style, arrival: null });
    });
    notify('Lien retour ajouté');
  };

  const testLink = async (h: LinkHotspot) => {
    if (!pv || !scene || !data) return;
    const target = sceneById(data, h.target);
    if (!target) return;
    setHsId(null);
    skipShow.current = target.id;
    const ok = await pv.transition(target.media, arrivalFor(data, scene.id, h), { toward: h, style: data.settings.transition, duration: data.settings.duration });
    if (ok) setSceneId(target.id);
    else skipShow.current = null;
  };

  const setDefaultView = async () => {
    if (!pv || !scene) return;
    const v = pv.getView();
    const sid = scene.id, media = scene.media;
    mutate(d => { const s = sceneById(d, sid); if (s) s.view = v; });
    notify('Vue par défaut enregistrée');
    try {
      await api.thumb(media, v);
      mutate(d => { const s = sceneById(d, sid); if (s) s.thumbV = Date.now(); });
    } catch { /* vignette inchangée */ }
  };

  const deleteScene = (s: Scene) => {
    if (!data || !confirm(`Supprimer « ${s.name} » ?`)) return;
    const idx = data.scenes.findIndex(x => x.id === s.id);
    const rest = data.scenes.filter(x => x.id !== s.id);
    mutate(d => {
      d.scenes = d.scenes.filter(x => x.id !== s.id);
      d.scenes.forEach(x => { x.hotspots = x.hotspots.filter(h => !(isLink(h) && h.target === s.id)); });
      if (d.startScene === s.id) d.startScene = d.scenes[0]?.id ?? null;
    });
    setSceneId(rest[Math.min(idx, rest.length - 1)]?.id ?? null);
    setHsId(null);
    api.deleteMedia(s.media).catch(() => {});
    if (s.originalMedia) api.deleteMedia(s.originalMedia).catch(() => {});
  };

  /* ---------- retouche ---------- */
  const refreshThumb = (sid: string, media: string, v: View) =>
    api.thumb(media, v)
      .then(() => mutate(d => { const s = sceneById(d, sid); if (s) s.thumbV = Date.now(); }))
      .catch(() => {});

  const saveRetouch = async (blob: Blob) => {
    if (!doc || !scene) return;
    const sid = scene.id, old = scene.media, orig = scene.originalMedia ?? scene.media, v = scene.view;
    const file = new File([blob], `${cleanName(scene.name)}-retouche.jpg`, { type: 'image/jpeg' });
    const m = await api.upload(doc.id, file, () => {});
    mutate(d => { const s = sceneById(d, sid); if (s) { s.originalMedia = orig; s.media = m.id; } });
    if (old !== orig) api.deleteMedia(old).catch(() => {});
    setRetouch(null);
    notify('Retouche enregistrée');
    refreshThumb(sid, m.id, v);
  };

  const restoreOriginal = () => {
    if (!scene?.originalMedia || !confirm('Revenir à la photo d’origine ? Toutes les retouches seront perdues.')) return;
    const sid = scene.id, cur = scene.media, orig = scene.originalMedia, v = scene.view;
    mutate(d => { const s = sceneById(d, sid); if (s) { s.media = orig; delete s.originalMedia; } });
    api.deleteMedia(cur).catch(() => {});
    setRetouch(null);
    notify('Photo d’origine restaurée');
    refreshThumb(sid, orig, v);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    mutate(d => {
      const from = d.scenes.findIndex(s => s.id === fromId);
      const [m] = d.scenes.splice(from, 1);
      d.scenes.splice(d.scenes.findIndex(s => s.id === toId), 0, m);
    });
  };

  const addFiles = (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length || !doc) return;
    const items = imgs.map(file => ({ key: uid(), name: file.name, progress: 0, file }));
    setUploads(u => [...u, ...items.map(({ file: _f, ...rest }) => rest)]);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const it = items[next++];
        try {
          const m = await api.upload(doc.id, it.file, p => setUploads(u => u.map(x => (x.key === it.key ? { ...x, progress: p } : x))));
          const s: Scene = {
            id: uid(), name: cleanName(it.name), media: m.id, width: m.width, height: m.height, thumbV: 0,
            view: { yaw: 0, pitch: 0, fov: 75 }, hotspots: [],
            ...(m.geo ? { geo: m.geo } : {}),
            ...(m.captureTime ? { captureTime: m.captureTime } : {}),
          };
          mutate(d => { d.scenes.push(s); if (!d.startScene) d.startScene = s.id; });
          setSceneId(cur => cur ?? s.id);
          setUploads(u => u.filter(x => x.key !== it.key));
        } catch (e) {
          setUploads(u => u.map(x => (x.key === it.key ? { ...x, error: (e as Error).message } : x)));
          setTimeout(() => setUploads(u => u.filter(x => x.key !== it.key)), 4000);
        }
      }
    };
    worker();
    worker();
  };

  const doExport = async () => {
    try {
      const r = await api.exportCheck(id);
      if (!r.ok) { notify(r.error || 'Export impossible'); return; }
      location.href = api.exportUrl(id);
    } catch (e) { notify((e as Error).message); }
  };

  /* ---------- carte & Street View ---------- */
  const setGeo = (sid: string, fn: (g: NonNullable<Scene['geo']>) => Scene['geo']) =>
    mutate(d => { const s = sceneById(d, sid); if (s?.geo) s.geo = fn(s.geo); });

  const placeScene = (lat: number, lng: number) => {
    if (!data || !scene) return;
    const sid = scene.id;
    mutate(d => {
      const s = sceneById(d, sid);
      if (s) s.geo = { lat, lng, heading: s.geo?.heading ?? null };
    });
    // enchaîner sur la photo suivante non placée
    const next = data.scenes.find(s => !s.geo && s.id !== sid);
    if (next) setSceneId(next.id);
    else setMapTool('select');
  };

  const linkOnMap = (a: string, b: string) => {
    if (!data) return;
    const sa = sceneById(data, a), sb = sceneById(data, b);
    if (sa && sb && (headingOf(data, sa) == null || headingOf(data, sb) == null)) {
      notify('Pont créé — orientez les photos (Nord ici) pour placer précisément les passages');
    }
    mutate(d => addBridge(d, a, b));
  };

  const autoLink = () => {
    if (!data) return;
    const n = autoBridges(structuredClone(data));
    if (n) mutate(d => { autoBridges(d); });
    notify(n ? `${n} pont${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''}` : 'Aucune photo proche à relier (≤ 40 m)');
  };

  /** Déplacement d'une photo sur la carte : si elle appartient au relevé calé, tout le relevé suit. */
  const moveOnMap = (sid: string, lat: number, lng: number) => {
    const s = data && sceneById(data, sid);
    const plan = data?.plan;
    if (!s?.planPoint || !plan?.anchor) { setGeo(sid, g => ({ ...g, lat, lng })); return; }
    const pid = s.planPoint;
    mutate(d => {
      const a = d.plan!.anchor!;
      if (pid === a.pointId) { a.lat = lat; a.lng = lng; }
      else { const r = rotationToward(d.plan!, pid, { lat, lng }); if (r != null) a.rotation = r; }
      applyPlan(d);
    });
  };

  /* ---------- relevé (plan) ---------- */
  const importPlan = async (f: File) => {
    try {
      const p = parsePlan(await f.text());
      if (!data || (data.plan && !confirm('Remplacer le relevé actuel ?'))) return;
      const m = matchByTime(p.points, data.scenes), n = m.size;
      mutate(d => {
        d.plan = { ...p, lensOffset: d.plan?.lensOffset ?? 0, anchor: null };
        d.scenes.forEach(s => { delete s.planPoint; const pid = m.get(s.id); if (pid) s.planPoint = pid; });
      });
      setPlanSel(null);
      setStage('plan');
      notify(`${p.points.length} points · ${n} photo${n > 1 ? 's' : ''} reliée${n > 1 ? 's' : ''}`);
    } catch (e) { notify((e as Error).message); }
  };

  const autoMatch = () => {
    if (!data?.plan) return;
    const m = matchByTime(data.plan.points, data.scenes), n = m.size;
    mutate(d => {
      d.scenes.forEach(s => { delete s.planPoint; const pid = m.get(s.id); if (pid) s.planPoint = pid; });
      applyPlan(d);
    });
    notify(`${n} photo${n > 1 ? 's' : ''} reliée${n > 1 ? 's' : ''}`);
  };

  const linkPoint = (pid: string, sid: string) => {
    if (!data?.plan) return;
    mutate(d => {
      d.scenes.forEach(s => { if (s.planPoint === pid) delete s.planPoint; });
      const s = sceneById(d, sid);
      if (s) s.planPoint = pid;
      applyPlan(d);
    });
    setSceneId(sid);
    // enchaîner sur le point suivant sans photo
    const pts = [...data.plan.points].sort((a, b) => a.n - b.n);
    const cur = pts.find(p => p.id === pid)!;
    const next = pts.find(p => p.n > cur.n && p.id !== pid && !data.scenes.some(s => s.planPoint === p.id && s.id !== sid));
    setPlanSel(next?.id ?? null);
  };

  const unlinkPoint = (pid: string) => mutate(d => { d.scenes.forEach(s => { if (s.planPoint === pid) delete s.planPoint; }); });

  const startAnchor = (pid: string) => {
    setPlanSel(pid);
    setStage('map');
    setMapTool('anchor');
  };

  const placeAnchor = (lat: number, lng: number) => {
    const pid = planSel ?? data?.plan?.anchor?.pointId;
    if (!pid) return;
    mutate(d => {
      if (!d.plan) return;
      d.plan.anchor = { pointId: pid, lat, lng, rotation: d.plan.anchor?.rotation ?? d.plan.northHint ?? 0 };
      applyPlan(d);
    });
    setMapTool('select');
    notify('Relevé calé — glissez une autre photo pour ajuster la rotation');
  };

  const planBridges = () => {
    if (!data?.plan) return;
    const run = (d: TourData) => {
      const ids = [...d.plan!.points].sort((a, b) => a.n - b.n).map(p => sceneOfPoint(d, p.id)?.id).filter((x): x is string => !!x);
      for (let i = 1; i < ids.length; i++) addBridge(d, ids[i - 1], ids[i]);
    };
    const count = (d: TourData) => d.scenes.reduce((n, s) => n + s.hotspots.length, 0);
    const trial = structuredClone(data);
    run(trial);
    const n = Math.round((count(trial) - count(data)) / 2);
    if (n) mutate(run);
    notify(n ? `${n} pont${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''}` : 'Parcours déjà relié');
  };

  const removePlan = () => {
    if (!confirm('Retirer le relevé ? Les positions déjà calées sont conservées.')) return;
    mutate(d => { delete d.plan; d.scenes.forEach(s => { delete s.planPoint; }); });
    setPlanSel(null);
  };

  const editPlan = (fn: (p: NonNullable<TourData['plan']>) => void) =>
    mutate(d => { if (d.plan) { fn(d.plan); applyPlan(d); } });

  const setSetting = <K extends keyof TourSettings>(k: K, v: TourSettings[K]) => mutate(d => { d.settings[k] = v; });

  /* ---------- raccourcis clavier ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (retouch || (e.target as Element).closest('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if (k === 'r' && pv && scene) setRetouch(pv.getView());
      else if (k === 'v') setTool('select');
      else if (k === 'l') setTool('link');
      else if (k === 'i') setTool('info');
      else if (k === 'escape') { setTool('select'); setHsId(null); }
      else if ((k === 'delete' || k === 'backspace') && hsId) { deleteHs(hsId); e.preventDefault(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /* ---------- rendu ---------- */
  if (err) return <div className="center-msg"><p>{err}</p><Link className="btn" to="/">Mes visites</Link></div>;
  if (!doc || !data) return <div className="center-msg"><span className="spinner" /></div>;

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <div
      className="ed"
      onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target || !e.relatedTarget) setDropping(false); }}
      onDrop={e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        const planFile = files.find(f => /\.uvplan(\.(json|txt))?$/i.test(f.name));
        if (planFile) importPlan(planFile);
        else addFiles(files);
      }}
    >
      <header className="ed-top">
        <Link to="/" className="ed-home" title="Mes visites"><UrbanviewInline /></Link>
        <span className="ed-sep" />
        <input className="ed-title" value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })} />
        <span className={`save-dot ${saveState}`} title={saveState === 'saved' ? 'Enregistré' : saveState === 'saving' ? 'Enregistrement…' : 'Erreur d’enregistrement'} />
        <div className="grow" />
        <div className="seg ed-stage-seg">
          <button className={stage === '360' ? 'on' : ''} onClick={() => setStage('360')}><Icon n="pano" />360</button>
          <button className={stage === 'plan' ? 'on' : ''} onClick={() => { setStage('plan'); setHsId(null); setSettings(false); setSvOpen(false); }}><Icon n="plan" />Plan</button>
          <button className={stage === 'map' ? 'on' : ''} onClick={() => { setStage('map'); setHsId(null); }}><Icon n="map" />Carte</button>
        </div>
        <span className="ed-sep" />
        <button className={'ibtn' + (svOpen ? ' on' : '')} title="Publier sur Google Street View" onClick={() => { setSvOpen(s => !s); setSettings(false); setHsId(null); }}><Icon n="globe" /></button>
        <button className={'ibtn' + (settings ? ' on' : '')} title="Réglages" onClick={() => { setSettings(s => !s); setSvOpen(false); setHsId(null); }}><Icon n="settings" /></button>
        <a className="btn ghost" href={`/tour/${doc.id}`} target="_blank" rel="noopener"><Icon n="eye" />Aperçu</a>
        <button className="btn pri" onClick={doExport}><Icon n="download" />Exporter</button>
      </header>

      <aside className="ed-scenes">
        {data.scenes.map(s => (
          <button
            key={s.id}
            draggable
            className={'sc-item' + (s.id === sceneId ? ' on' : '') + (overScene === s.id ? ' over' : '')}
            onClick={() => {
              if (stage === 'plan' && planSel) { linkPoint(planSel, s.id); return; }
              setSceneId(s.id); setHsId(null);
              if (stage === 'plan' && s.planPoint) setPlanSel(s.planPoint);
            }}
            onDragStart={e => { dragScene.current = s.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
            onDragOver={e => { if (dragScene.current) { e.preventDefault(); setOverScene(s.id); } }}
            onDragLeave={() => setOverScene(null)}
            onDrop={e => { if (!dragScene.current) return; e.preventDefault(); e.stopPropagation(); reorder(dragScene.current, s.id); dragScene.current = null; setOverScene(null); }}
            onDragEnd={() => { dragScene.current = null; setOverScene(null); }}
          >
            <img src={thumbOf(s)} alt="" draggable={false} />
            {data.startScene === s.id && <span className="sc-star"><Icon n="star" /></span>}
            {stage === 'map' && <span className={'sc-geo' + (s.geo ? ' on' : '')} title={s.geo ? 'Placée sur la carte' : 'Non placée'}><Icon n="pin" /></span>}
            {stage === 'plan' && data.plan && (
              <span className={'sc-geo' + (s.planPoint ? ' on' : '')}>
                {data.plan.points.find(p => p.id === s.planPoint)?.n ?? '–'}
              </span>
            )}
            <span className="sc-name">{s.name}</span>
          </button>
        ))}
        {uploads.map(u => (
          <div className={'sc-item up' + (u.error ? ' fail' : '')} key={u.key}>
            <div className="up-bar"><i style={{ width: `${(u.error ? 1 : u.progress) * 100}%` }} /></div>
            <span className="sc-name">{u.error ?? (u.progress < 1 ? `${Math.round(u.progress * 100)} %` : 'Optimisation…')}</span>
          </div>
        ))}
        <label className="sc-add" title="Ajouter des photos 360°">
          <Icon n="plus" />
          <input type="file" multiple accept="image/*" hidden onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
      </aside>

      <main className={'ed-stage' + (tool !== 'select' ? ' placing' : '')}>
        <div className="pano-wrap">
          <div className="pano-gl" ref={glRef} />
          {scene && (
            <HotspotLayer
              pv={pv}
              hotspots={scene.hotspots}
              selected={hsId}
              editable
              onSelect={hid => { setHsId(hid); setSettings(false); setSvOpen(false); setTool('select'); }}
              onMove={(hid, yaw, pitch) => editHs(scene.id, hid, h => { h.yaw = yaw; h.pitch = pitch; })}
            />
          )}
        </div>
        {stage === 'map' && (
          <div className="ed-map">
            <MapView
              data={data}
              selected={sceneId}
              tool={mapTool}
              thumbOf={thumbOf}
              onSelect={sid => { setSceneId(sid); setHsId(null); }}
              onPlace={placeScene}
              onMove={moveOnMap}
              onLink={linkOnMap}
              onUnlink={(a, b) => mutate(d => removeBridge(d, a, b))}
              ghosts={ghosts}
              anchorN={data.plan?.points.find(p => p.id === (planSel ?? data.plan?.anchor?.pointId))?.n}
              onAnchor={placeAnchor}
            />
            <div className="ed-tools glass">
              <button className={mapTool === 'select' ? 'on' : ''} title="Sélection / déplacer" onClick={() => setMapTool('select')}><Icon n="cursor" /></button>
              <button className={mapTool === 'place' ? 'on' : ''} title="Placer la photo sélectionnée" onClick={() => setMapTool(t => (t === 'place' ? 'select' : 'place'))}><Icon n="pin" /></button>
              <button className={mapTool === 'link' ? 'on' : ''} title="Tracer des ponts" onClick={() => setMapTool(t => (t === 'link' ? 'select' : 'link'))}><Icon n="link" /></button>
              <span className="ed-tools-sep" />
              <button title="Relier automatiquement les photos proches" onClick={autoLink}><Icon n="wand" /></button>
            </div>
          </div>
        )}
        {stage === 'plan' && (
          <div className="ed-map">
            <PlanView
              data={data}
              plan={data.plan}
              selected={planSel}
              thumbOf={thumbOf}
              onSelect={pid => {
                setPlanSel(pid);
                const s = pid ? sceneOfPoint(data, pid) : null;
                if (s) { setSceneId(s.id); setHsId(null); }
              }}
              onDropScene={linkPoint}
              onImport={importPlan}
            />
          </div>
        )}
        {scene && stage === '360' && (
          <div className="ed-tools glass">
            <button className={tool === 'select' ? 'on' : ''} title="Sélection (V)" onClick={() => setTool('select')}><Icon n="cursor" /></button>
            <button className={tool === 'link' ? 'on' : ''} title="Lien (L)" onClick={() => setTool(t => (t === 'link' ? 'select' : 'link'))}><Icon n="ring" /></button>
            <button className={tool === 'info' ? 'on' : ''} title="Info (I)" onClick={() => setTool(t => (t === 'info' ? 'select' : 'info'))}><Icon n="info" /></button>
            <span className="ed-tools-sep" />
            <button title="Retouche : flou, effacement (R)" onClick={() => pv && setRetouch(pv.getView())}><Icon n="brush" /></button>
          </div>
        )}
        {!data.scenes.length && !uploads.length && (
          <label className="ed-empty">
            <UrbanviewLogo size={180} />
            <span className="btn pri big"><Icon n="upload" />Importer des photos 360°</span>
            <input type="file" multiple accept="image/*" hidden onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        )}
        {dropping && <div className="ed-drop"><Icon n="upload" /></div>}
      </main>

      <aside className="ed-insp">
        {svOpen ? (
          <StreetViewPanel tourId={doc.id} data={data} flush={saveNow} notify={notify} />
        ) : stage === 'plan' && !settings ? (
          <PlanPanel
            data={data}
            plan={data.plan}
            selected={planSel}
            onImport={importPlan}
            onAutoMatch={autoMatch}
            onUnlink={unlinkPoint}
            onAnchor={startAnchor}
            onRotation={deg => editPlan(p => { if (p.anchor) p.anchor.rotation = deg; })}
            onLens={deg => editPlan(p => { p.lensOffset = deg; })}
            onBridges={planBridges}
            onRemove={removePlan}
          />
        ) : settings ? (
          <SettingsPanel data={data} set={setSetting} setStart={sid => mutate(d => { d.startScene = sid; })} />
        ) : hs && scene ? (
          hs.type === 'link' ? (
            <LinkPanel
              data={data}
              scene={scene}
              h={hs}
              edit={fn => editHs<LinkHotspot>(scene.id, hs.id, fn)}
              onDelete={() => deleteHs(hs.id)}
              onTest={() => testLink(hs)}
              onBacklink={() => backlink(hs)}
            />
          ) : (
            <InfoPanel h={hs} edit={fn => editHs<InfoHotspot>(scene.id, hs.id, fn)} onDelete={() => deleteHs(hs.id)} />
          )
        ) : scene ? (
          <ScenePanel
            data={data}
            scene={scene}
            pv={pv}
            isStart={startSceneOf(data)?.id === scene.id}
            rename={name => mutate(d => { const s = sceneById(d, scene.id); if (s) s.name = name; })}
            setDefaultView={setDefaultView}
            editLink={(sid, hid, fn) => editHs<LinkHotspot>(sid, hid, fn)}
            onSetStart={() => mutate(d => { d.startScene = scene.id; })}
            onDelete={() => deleteScene(scene)}
            heading={headingOf(data, scene)}
            setGeo={fn => setGeo(scene.id, fn)}
            onPlaceOnMap={() => { setStage('map'); setMapTool('place'); }}
            onNorthHere={stage === '360' && pv ? () => setGeo(scene.id, g => ({ ...g, heading: headingFromNorthView(pv.getView().yaw) })) : undefined}
          />
        ) : null}
      </aside>

      {retouch && scene && (
        <RetouchStudio
          key={scene.media}
          scene={scene}
          sourceUrl={`/media/${scene.media}/full.jpg`}
          startView={retouch}
          onCancel={() => setRetouch(null)}
          onSave={saveRetouch}
          onRestore={scene.originalMedia ? restoreOriginal : undefined}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
